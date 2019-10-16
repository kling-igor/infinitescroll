// const { ipcRenderer } = window.require('electron')
// const { callMain } = require('./ipc').default(ipcRenderer)
import { CompositeDisposable, Disposable, Emitter } from 'event-kit'
import path from 'path'
import * as _ from 'lodash'
import { observable, action, transaction, computed } from 'mobx'
import { callMain } from './ipc'
import * as MESSAGES from '../common/messages'
import { FileWrapper } from './components/vcs/file-wrapper'

const cleanLeadingSlashes = filePath => filePath.replace(/^[\.\/]*/, '')

/**
 * Convenient function
 * @param {EventEmitter} emitter
 * @param {String} eventName
 * @param {Function} handler
 * @returns {Disposable}
 */
const disposableEventHandler = (emitter, eventName, handler) => {
  emitter.on(eventName, handler)

  return new Disposable(() => {
    emitter.off(eventName, handler)
  })
}

const sort = array =>
  array.sort((a, b) => {
    const aStr = `${a.path}/${a.filename}`
    const bStr = `${b.path}/${b.filename}`

    if (aStr > bStr) {
      return 1
    }
    if (aStr < bStr) {
      return -1
    }
    return 0
  })

export class VCS extends Emitter {
  @observable logUpdateTime = null

  @observable mode = 'log' // log | commit

  // committer info
  @observable name = ''
  @observable email = ''

  // alternative committer info
  @observable alterName = ''
  @observable alterEmail = ''

  // commit
  @observable commitMessage = ''

  @observable.ref changedFiles = []
  @observable.ref stagedFiles = []

  // array of previous commit messages
  @observable.ref previousCommits = []

  @observable showSHA = true
  @observable showDate = true
  @observable showAuthor = true

  @observable showAuthorType = 'FULL_NAME_WITH_EMAIL' // ABBREVIATED | FULL_NAME | FULL_NAME_WITH_EMAIL

  // diff editor
  @observable originalFile = null
  @observable modifiedFile = null

  @observable diffConflictedFile = false

  // file path of diff
  @observable selectedFilePath = null

  @computed get selectedChangedFile() {
    const found = this.changedFiles.find(item => `${item.path}/${item.filename}` === this.selectedFilePath)
    if (found) return `${found.path}/${found.filename}`
  }

  @computed get selectedStagedFile() {
    const found = this.stagedFiles.find(item => `${item.path}/${item.filename}` === this.selectedFilePath)
    if (found) return `${found.path}/${found.filename}`
  }

  @computed get hasLocalChanges() {
    return this.changedFiles.length > 0
  }

  // git tree
  @observable commitsCount = 0
  @observable.ref committers = []
  @observable.ref heads = []
  @observable.ref remoteHeads = []
  @observable.ref tags = []
  @observable.ref remotes = []
  @observable maxOffset = 0

  @observable headCommit = null

  @observable currentBranch = null

  @observable isMerging = false
  @observable isRebasing = false

  @observable.ref commitInfo = null

  @computed get canCommit() {
    if (this.isMerging) {
      return this.changedFiles.length === 0
    }

    return this.stagedFiles.length > 0
  }

  @computed get selectedCommit() {
    if (!this.commitInfo) return null

    return this.commitInfo.commit
  }

  @observable commitSelectedFile = null

  @observable isProcessingGitLog = false

  @observable pendingOperation = null

  constructor({ workspace, project, applicationDelegate }) {
    super()

    this.workspace = workspace
    this.project = project
    this.applicationDelegate = applicationDelegate

    this.debouncedStatus = _.debounce(this.status, 1000)

    // applicationDelegate.onGitLog(this.onGitLog)
    // applicationDelegate.onFetch(this.onFetch)
    // applicationDelegate.onPush(this.onPush)
    // applicationDelegate.onPull(this.onPull)

    this.on(
      'operation:begin',
      action(operation => {
        if (!this.pendingOperation) {
          this.pendingOperation = operation
        }
      })
    )

    this.on(
      'operation:finish',
      action(operation => {
        if (this.pendingOperation === operation) {
          this.pendingOperation = null
        }
      })
    )
  }

  @action.bound
  setAlterUserNameEmail(userName = '', email = '') {
    transaction(() => {
      this.alterName = userName
      this.alterEmail = email
    })
  }

  @action.bound
  onChangedFilesChanged(files) {
    this.changedFiles = files
  }

  @action.bound
  onStagedFilesChanged(files) {
    this.stagedFiles = files
  }

  @action.bound
  setCommitMessage(event) {
    this.commitMessage = event.target.value
  }

  // ui-optimistic addition to index specified files
  @action
  addToStage(collection) {
    let selected = collection.slice()

    const [filtered, remained] = this.changedFiles.reduce(
      (acc, item) => {
        const fullPath = `${item.path}/${item.filename}`
        const index = selected.findIndex(i => i === fullPath)
        if (index !== -1) {
          acc[0].push(item)
          selected = [...selected.slice(0, index), ...selected.slice(index + 1)]
        } else {
          acc[1].push(item)
        }

        return acc
      },
      [[], []]
    )

    transaction(() => {
      this.stagedFiles = sort([...new Set([...this.stagedFiles, ...filtered])])
      this.changedFiles = sort(remained)
    })

    // вызываем операцию добавления в индекс
    // по факту операции меняем состояние
  }

  // ui-optimistic removing from index specified files
  @action
  removeFromStage(collection) {
    let selected = collection.slice()

    const [filtered, remained] = this.stagedFiles.reduce(
      (acc, item) => {
        const fullPath = `${item.path}/${item.filename}`
        const index = selected.findIndex(i => i === fullPath)
        if (index !== -1) {
          acc[0].push(item)
          selected = [...selected.slice(0, index), ...selected.slice(index + 1)]
        } else {
          acc[1].push(item)
        }

        return acc
      },
      [[], []]
    )

    transaction(() => {
      this.changedFiles = sort([...new Set([...this.changedFiles, ...filtered])])
      this.stagedFiles = sort(remained)
    })

    // вызываем операцию удаления из индекса
    // по факту операции меняем состояние
  }

  @action.bound
  async createBranch(name) {
    await callMain(MESSAGES.VCS_CREATE_BRANCH, name, this.headCommit)
    await callMain(MESSAGES.VCS_CHECKOUT_BRANCH, name, false)
    await this.getLog()
  }

  @action.bound
  async deleteBranch(name) {
    await callMain(MESSAGES.VCS_DELETE_BRANCH, name)
    await this.getLog()
  }

  @action.bound
  async createTag(target, name, message) {
    await callMain(MESSAGES.VCS_CREATE_TAG, target, name, message)
    await this.getLog()
  }

  @action.bound
  async deleteTag(name) {
    await callMain(MESSAGES.VCS_DELETE_TAG, name)
    await this.getLog()
  }

  @action.bound
  async softResetCommit(sha) {
    await callMain(MESSAGES.VCS_RESET_COMMIT_SOFT, sha)
    await this.getLog()
  }

  @action.bound
  async mixedResetCommit(sha) {
    await callMain(MESSAGES.VCS_RESET_COMMIT_MIXED, sha)
    await this.getLog()
  }

  @action.bound
  async hardResetCommit(sha) {
    await callMain(MESSAGES.VCS_RESET_COMMIT_HARD, sha)
    await this.getLog()
  }

  @action.bound
  async revertCommit(sha) {
    await callMain(MESSAGES.VCS_REVERT_COMMIT, sha)
    await this.getLog()
    await this.status()
  }

  @action.bound
  async status() {
    const statuses = await callMain(MESSAGES.VCS_GET_REPOSITORY_STATUS)
    console.log('STATUSES:', statuses)

    const STAGED = 0
    const CHANGED = 1

    const [stagedFiles, changedFiles] = statuses.reduce(
      (acc, item) => {
        const { status } = item

        let selected = false

        let workdirStatus = ''
        let stagedStatus = ''

        if (status.includes('CONFLICTED')) {
          workdirStatus = 'C'
        }

        if (status.includes('WT_NEW')) {
          workdirStatus = 'A'
        }

        if (status.includes('WT_MODIFIED')) {
          workdirStatus = 'M'
        }

        if (status.includes('WT_DELETED')) {
          workdirStatus = 'D'
        }

        if (status.includes('WT_RENAMED')) {
          // должно идти после M
          workdirStatus = 'R'
        }

        if (status.includes('INDEX_NEW')) {
          stagedStatus = 'A'
        }

        if (status.includes('INDEX_MODIFIED')) {
          stagedStatus = 'M'
        }

        if (status.includes('INDEX_DELETED')) {
          stagedStatus = 'D'
        }

        if (status.includes('INDEX_RENAMED')) {
          stagedStatus = 'R'
        }

        // special cases

        // unstaging changes
        if (workdirStatus === 'A' && stagedStatus === 'D') {
          stagedStatus = ''
          workdirStatus = 'M'
        }

        if (stagedStatus) {
          const foundInStaged = this.stagedFiles.find(
            ({ path: filePath, filename }) => filePath === item.path && filename === item.filename
          )
          selected = (foundInStaged && foundInStaged.selected) || false
          acc[STAGED].push({ ...item, selected, status: stagedStatus })
        }

        // }

        if (workdirStatus) {
          const foundInChanged = this.changedFiles.find(
            ({ path: filePath, filename }) => filePath === item.path && filename === item.filename
          )
          selected = (foundInChanged && foundInChanged.selected) || false
          acc[CHANGED].push({ ...item, selected, status: workdirStatus })
        }

        return acc
      },
      [[], []]
    )

    transaction(() => {
      this.changedFiles = changedFiles
      this.stagedFiles = stagedFiles
    })
  }

  @action.bound
  async onChangedFileSelect(filePath) {
    console.log('CLICK ON CHANGED FILE:', filePath)

    // TODO:  нужно проверить статус
    // если M C A то есть смысл читать локальную копию
    // если D то локальная копия отсутствует

    let mime

    const fileType = await callMain(MESSAGES.CORE_GET_FILE_TYPE, filePath)
    if (fileType) {
      mime = fileType.mime
    }

    const { status } = this.changedFiles.find(item => `${item.path}/${item.filename}` === filePath)

    if (status === 'C') {
      if (mime === 'text/plain') {
        const { mineContent = '', theirsContent = '' } = await callMain(
          MESSAGES.VCS_DIFF_CONFLICTED,
          cleanLeadingSlashes(filePath)
        ) // remove leading slash)

        transaction(() => {
          this.originalFile = FileWrapper.createTextFile({ path: filePath, content: mineContent })
          this.modifiedFile = FileWrapper.createTextFile({ path: filePath, content: theirsContent })
          this.selectedFilePath = filePath
          this.diffConflictedFile = true
        })
      } else if (mime.includes('image/')) {
        const mineTmpPath = callMain(MESSAGES.VCS_CREATE_OUR_TMP_FILE, filePath)
        const theirsTmpPath = callMain(MESSAGES.VCS_CREATE_THEIR_TMP_FILE, filePath)
        // todo очищать файлы как только развыделяется файл

        this.originalFile = FileWrapper.createImageFile({ path: filePath, tmpPath: mineTmpPath })
        this.modifiedFile = FileWrapper.createImageFile({ path: filePath, tmpPath: theirsTmpPath })
        this.selectedFilePath = filePath
        this.diffConflictedFile = true
      } else {
        transaction(() => {
          this.originalFile = FileWrapper.createBinaryDataFile({ path: filePath })
          this.modifiedFile = FileWrapper.createBinaryDataFile({ path: filePath })
          this.selectedFilePath = filePath
          this.diffConflictedFile = true
        })
      }
    } else if (status === 'A') {
      if (mime === 'text/plain') {
        // получить реальный контент файла
        const content = await callMain(MESSAGES.CORE_OPEN_FILE, filePath)
        transaction(() => {
          this.originalFile = FileWrapper.createTextFile({ path: filePath, content: '' })
          this.modifiedFile = FileWrapper.createTextFile({ path: filePath, content })
          this.selectedFilePath = filePath
          this.diffConflictedFile = false
        })
      } else if (mime.includes('image/')) {
        transaction(() => {
          this.originalFile = FileWrapper.createEmpty({ path: filePath })
          this.modifiedFile = FileWrapper.createImageFile({
            path: filePath,
            tmpPath: path.resolve(this.projectPath, filePath)
          })
          this.selectedFilePath = filePath
          this.diffConflictedFile = false
        })
      } else {
        transaction(() => {
          this.originalFile = FileWrapper.createEmpty({ path: filePath })
          this.modifiedFile = FileWrapper.createBinaryDataFile({ path: filePath, mime })
          this.selectedFilePath = filePath
          this.diffConflictedFile = false
        })
      }
    } else {
      if (mime === 'text/plain') {
        const { originalContent = '', modifiedContent = '', details: errorDetails } = await callMain(
          MESSAGES.VCS_DIFF_TO_INDEX,
          this.projectPath,
          cleanLeadingSlashes(filePath)
        )

        transaction(() => {
          this.originalFile = FileWrapper.createTextFile({ path: filePath, content: originalContent })
          this.modifiedFile = FileWrapper.createTextFile({ path: filePath, content: modifiedContent })
          this.selectedFilePath = filePath
          this.diffConflictedFile = false
        })
      } else if (mime.includes('image/')) {
        const mineTmpPath = callMain(MESSAGES.VCS_CREATE_OUR_TMP_FILE, filePath)
        const indexedTmpPath = callMain(MESSAGES.VCS_CREATE_INDEXED_TMP_FILE, this.projectPath, filePath)
        // todo очищать файлы как только развыделяется файл

        this.originalFile = FileWrapper.createImageFile({ path: filePath, tmpPath: mineTmpPath })
        this.modifiedFile = FileWrapper.createImageFile({ path: filePath, tmpPath: indexedTmpPath })
        this.selectedFilePath = filePath
        this.diffConflictedFile = true
      } else {
        transaction(() => {
          this.originalFile = FileWrapper.createBinaryDataFile({ path: filePath })
          this.modifiedFile = FileWrapper.createBinaryDataFile({ path: filePath })
          this.selectedFilePath = filePath
          this.diffConflictedFile = false
        })
      }
    }
  }

  @action.bound
  async onStagedFileSelect(filePath) {
    let mime

    const fileType = await callMain(MESSAGES.CORE_GET_FILE_TYPE, filePath)
    if (fileType) {
      mime = fileType.mime
    }

    if (mime === 'text/plain') {
      const { originalContent = '', modifiedContent = '', details: errorDetails } = await callMain(
        MESSAGES.VCS_DIFF_STAGED_TO_HEAD,
        cleanLeadingSlashes(filePath)
      )

      transaction(() => {
        this.originalFile = FileWrapper.createTextFile({ path: filePath, content: originalContent })
        this.modifiedFile = FileWrapper.createTextFile({ path: filePath, content: modifiedContent })
        this.selectedFilePath = filePath
        this.diffConflictedFile = false
      })
    } else {
      transaction(() => {
        this.originalFile = FileWrapper.createBinaryDataFile({ path: filePath })
        this.modifiedFile = FileWrapper.createBinaryDataFile({ path: filePath })
        this.selectedFilePath = filePath
        this.diffConflictedFile = false
      })
    }
  }

  @action
  async open(projectPath) {
    this.projectPath = projectPath

    const { user, remotes } = await callMain(MESSAGES.VCS_OPEN_REPOSITORY, projectPath)

    if (user) {
      const { name, email } = user
      transaction(() => {
        this.name = name
        this.email = email
      })
    }

    if (remotes) {
      this.remotes = remotes
    }

    this.disposables = new CompositeDisposable()

    // on project open
    this.disposables.add(
      disposableEventHandler(this.project, 'project-opened', () => {
        this.projectDisposables = new CompositeDisposable()

        this.projectDisposables.add(
          this.applicationDelegate.onProjectFilePathAdd((sender, filePath) => {
            console.log(`[VCS] added ${filePath.replace(this.project.projectPath, '')}`)

            if (this.changedFiles.length === 0) {
              this.getLog()
            }

            this.debouncedStatus()
          }),

          this.applicationDelegate.onProjectFilePathRemove((sender, filePath) => {
            const relativePath = filePath.replace(this.project.projectPath, '')
            console.log(`[VCS] removed ${relativePath}`)
            // this.fileTreeView.remove(relativePath)

            if (this.changedFiles.length === 0) {
              this.getLog()
            }

            this.debouncedStatus()
          }),

          this.applicationDelegate.onProjectFilePathRename((sender, src, dst) => {
            console.log(
              `[VCS] renaming ${src.replace(this.project.projectPath, '')} to ${dst.replace(
                this.project.projectPath,
                ''
              )}`
            )

            if (this.changedFiles.length === 0) {
              this.getLog()
            }

            this.debouncedStatus()
            // this.fileTreeView.rename(
            //   src.replace(vision.project.projectPath, ''),
            //   dst.replace(vision.project.projectPath, '')
            // )
          }),

          this.applicationDelegate.onProjectFilePathChange((sender, filePath) => {
            console.log(`[VCS] changed outside of IDE ${filePath.replace(this.project.projectPath, '')}`)

            if (this.changedFiles.length === 0) {
              this.getLog()
            }

            this.debouncedStatus()
          })
        )
      }),

      disposableEventHandler(this.project, 'project-closed', () => {
        if (this.projectDisposables) {
          this.projectDisposables.dispose()
          this.projectDisposables = null
        }
      })
    )

    this.debouncedStatus()
  }

  @action.bound
  async getLog() {
    this.isProcessingGitLog = true

    let log
    let error

    try {
      ;({ log, error } = await callMain(MESSAGES.VCS_GET_LOG, this.project.projectPath))

      if (error) {
        console.log('GITLOG ERROR:', error)
        return
      }
    } catch (e) {
      console.log('repository:log ERROR:', e)
    }

    this.isProcessingGitLog = false

    const {
      commitsCount = 0,
      committers = [],
      refs = [],
      maxOffset = 0,
      headCommit,
      currentBranch,
      isMerging = false,
      isRebasing = false,
      hasConflicts = false
    } = log

    const LOCAL_HEADS = 0
    const REMOTE_HEADS = 1
    const TAGS = 2

    const [heads, remoteHeads, tags] = refs.reduce(
      (acc, item) => {
        const { name } = item

        if (name.includes('refs/heads/')) {
          acc[LOCAL_HEADS].push({ ...item, name: name.replace('refs/heads/', '') })
        } else if (name.includes('refs/remotes/')) {
          acc[REMOTE_HEADS].push({ ...item, name: name.replace('refs/remotes/', '') })
        } else if (name.includes('refs/tags/')) {
          acc[TAGS].push({ ...item, name: name.replace('refs/tags/', '') })
        }

        return acc
      },
      [[], [], []]
    )

    transaction(() => {
      this.commitsCount = commitsCount
      this.committers = committers
      this.heads = heads
      this.maxOffset = maxOffset
      this.remoteHeads = remoteHeads
      this.tags = tags
      this.headCommit = headCommit
      this.currentBranch = currentBranch
      this.isMerging = isMerging
      this.isRebasing = isRebasing
      this.hasConflicts = hasConflicts

      this.logUpdateTime = Date.now()
    })
  }

  @action.bound
  async onCommitSelect(sha) {
    if (this.commitInfo && this.commitInfo.commit === sha) return

    if (!sha) {
      this.commitMode()
      return
    }

    const commitInfo = await callMain(MESSAGES.VCS_GET_COMMIT_DETAILS, sha)

    transaction(() => {
      this.originalFile = null
      this.modifiedFile = null
      this.commitSelectedFile = null
      this.diffConflictedFile = false
      this.commitInfo = commitInfo
    })
  }

  @action.bound
  async onCommitFileSelect(filePath) {
    if (!this.commitInfo) return
    if (this.commitSelectedFile === filePath) return

    this.commitSelectedFile = filePath

    let mime

    const fileType = await callMain(MESSAGES.CORE_GET_FILE_TYPE, filePath)
    if (fileType) {
      mime = fileType.mime
    }

    if (mime === 'text/plain') {
      try {
        // запрашиваем детальную информацию по файлу
        const { originalContent = '', modifiedContent = '', details: errorDetails } = await callMain(
          MESSAGES.VCS_DIFF_TO_PARENT,
          this.commitInfo.commit,
          cleanLeadingSlashes(filePath)
        )

        transaction(() => {
          this.originalFile = FileWrapper.createTextFile({ path: filePath, content: originalContent })
          this.modifiedFile = FileWrapper.createTextFile({ path: filePath, content: modifiedContent })
          this.diffConflictedFile = false
        })
      } catch (e) {
        console.log('FILE DETAILS ERROR:', e)
      }
    } else {
    }
  }

  @action.bound
  async onBranchCheckout(branch, discardLocalChanges) {
    await callMain(MESSAGES.VCS_CHECKOUT_BRANCH, branch, discardLocalChanges)
    await this.getLog()
    await this.status()
  }

  @action.bound
  async onCheckoutToCommit(sha, discardLocalChanges) {
    await callMain(MESSAGES.VCS_CHECKOUT_COMMIT, sha, discardLocalChanges)
    await this.getLog()
    await this.status()
  }

  @action.bound
  async onCommit() {
    if (this.stagedFiles.length === 0 && !this.isMerging) return

    await callMain(
      MESSAGES.VCS_CREATE_COMMIT,
      this.commitMessage,
      this.mergingSha,
      this.alterName || this.name,
      this.alterEmail || this.email
    )

    this.mergingSha = null

    await this.getLog()
    await this.status()

    transaction(() => {
      const strippedMessage = this.commitMessage.slice(0, 80)
      if (this.previousCommits[0] !== strippedMessage) {
        this.previousCommits = [strippedMessage, ...this.previousCommits]
      }

      this.stagedFiles = []
      this.commitMessage = ''
    })

    this.logMode()
  }

  @action.bound
  onCancelCommit() {
    this.logMode()
  }

  @action.bound
  commitMode() {
    if (this.mode === 'commit') return

    transaction(() => {
      this.mode = 'commit'
      this.originalFile = null
      this.modifiedFile = null
      this.selectedFilePath = null
      this.commitSelectedFile = null
      this.diffConflictedFile = false

      this.emit('mode:changed', 'commit')
    })
  }

  @action.bound
  logMode() {
    if (this.mode === 'log') return
    transaction(() => {
      this.mode = 'log'
      this.originalFile = null
      this.modifiedFile = null
      this.selectedFilePath = null
      this.commitSelectedFile = null
      this.diffConflictedFile = false

      this.emit('mode:changed', 'log')
    })
  }

  selectAllFiles(collection) {
    return collection.map(item => ({ ...item, selected: true }))
  }

  unselectAllFiles(collection) {
    return collection.map(item => ({ ...item, selected: false }))
  }

  inverseSelection(collection) {
    return collection.map(item => ({ ...item, selected: !item.selected }))
  }

  @action.bound
  async stageSelectedFiles() {
    const paths = this.changedFiles.reduce((acc, item) => {
      if (item.selected) {
        return [...acc, cleanLeadingSlashes(`${item.path}/${item.filename}`)]
      }

      return acc
    }, [])
    if (paths.length > 0) {
      if (this.selectedChangedFile && paths.includes(cleanLeadingSlashes(this.selectedChangedFile))) {
        transaction(() => {
          this.selectedFilePath = null
          this.originalFile = null
          this.modifiedFile = null
          this.diffConflictedFile = false
        })
      }

      await callMain(MESSAGES.VCS_ADD_TO_STAGE, paths)
      await this.status()
    }
  }

  @action.bound
  async stageAllFiles() {
    const paths = this.changedFiles.reduce(
      (acc, item) => [...acc, cleanLeadingSlashes(`${item.path}/${item.filename}`)],
      []
    )
    if (paths.length > 0) {
      if (this.selectedChangedFile && paths.includes(cleanLeadingSlashes(this.selectedChangedFile))) {
        transaction(() => {
          this.selectedFilePath = null
          this.originalFile = null
          this.modifiedFile = null
          this.diffConflictedFile = false
        })
      }

      await callMain(MESSAGES.VCS_ADD_TO_STAGE, paths)
      await this.status()
    }
  }

  @action.bound
  async stageFile(filePath) {
    if (filePath === this.selectedChangedFile) {
      transaction(() => {
        this.selectedFilePath = null
        this.originalFile = null
        this.modifiedFile = null
        this.diffConflictedFile = false
      })
    }

    await callMain(MESSAGES.VCS_ADD_TO_STAGE, [cleanLeadingSlashes(filePath)])
    await this.status()

    console.log('STAGE FILE:', filePath, this.selectedChangedFile)
  }

  @action.bound
  async unstageSelectedFiles() {
    const paths = this.stagedFiles.reduce((acc, item) => {
      if (item.selected) {
        return [...acc, cleanLeadingSlashes(`${item.path}/${item.filename}`)]
      }

      return acc
    }, [])

    if (paths.length > 0) {
      if (this.selectedStagedFile && paths.includes(cleanLeadingSlashes(this.selectedStagedFile))) {
        transaction(() => {
          this.selectedFilePath = null
          this.originalFile = null
          this.modifiedFile = null
          this.diffConflictedFile = false
        })
      }
      await callMain(MESSAGES.VCS_REMOVE_FROM_STAGE, paths)
      await this.status()
    }
  }

  @action.bound
  async unstageAllFiles() {
    const paths = this.stagedFiles.reduce(
      (acc, item) => [...acc, cleanLeadingSlashes(`${item.path}/${item.filename}`)],
      []
    )

    if (paths.length > 0) {
      if (this.selectedStagedFile && paths.includes(cleanLeadingSlashes(this.selectedStagedFile))) {
        transaction(() => {
          this.selectedFilePath = null
          this.originalFile = null
          this.modifiedFile = null
          this.diffConflictedFile = false
        })
      }

      await callMain(MESSAGES.VCS_REMOVE_FROM_STAGE, paths)
      await this.status()
    }
  }

  @action.bound
  async unstageFile(filePath) {
    if (filePath === this.selectedStagedFile) {
      transaction(() => {
        this.selectedFilePath = null
        this.originalFile = null
        this.modifiedFile = null
        this.diffConflictedFile = false
      })
    }

    await callMain(MESSAGES.VCS_REMOVE_FROM_STAGE, [cleanLeadingSlashes(filePath)])
    await this.status()
  }

  @action.bound
  async discardLocalChanges(filePath) {
    await callMain(MESSAGES.VCS_DISCARD_LOCAL_CHANGES, this.project.projectPath, cleanLeadingSlashes(filePath))
    await this.status()
  }

  @action.bound
  async discardAllLocalChanges() {
    const paths = this.changedFiles.reduce(
      (acc, item) => [...acc, cleanLeadingSlashes(`${item.path}/${item.filename}`)],
      []
    )

    if (paths.length > 0) {
      if (this.selectedChangedFile && paths.includes(cleanLeadingSlashes(this.selectedChangedFile))) {
        transaction(() => {
          this.selectedFilePath = null
          this.originalFile = null
          this.modifiedFile = null
          this.diffConflictedFile = false
        })
      }
      await callMain(MESSAGES.VCS_DISCARD_LOCAL_CHANGES, this.project.projectPath, paths)
      await this.status()
    }
  }

  @action.bound
  async stopTracking(filePath) {
    await callMain(MESSAGES.VCS_REMOVE_FROM_STAGE, [cleanLeadingSlashes(filePath)])
    await this.status()
  }

  @action.bound
  async merge(sha, commitOnSuccess) {
    this.mergingSha = sha

    await callMain(MESSAGES.VCS_MERGE, sha)

    if (this.isMerging && commitOnSuccess) {
      await callMain(
        MESSAGES.VCS_CREATE_COMMIT,
        'Merge',
        sha,
        this.alterName || this.name,
        this.alterEmail || this.email
      )

      this.mergingSha = null

      await this.getLog()
      await this.status()

      this.logMode()

      return
    } else {
      await this.status()
      await this.getLog()
    }

    // this.commitMessage = `Merge branch '${}' into branch ${}`
    this.commitMessage = `Merge`
  }

  @action.bound
  async resolveUsingMine() {
    if (this.selectedFilePath) {
      await callMain(
        MESSAGES.VCS_RESOLE_USING_OUR,
        this.project.projectPath,
        cleanLeadingSlashes(this.selectedFilePath)
      )
      await this.status()

      transaction(() => {
        this.originalFile = null
        this.modifiedFile = null
        this.selectedFilePath = null
        this.diffConflictedFile = false
      })
    }
  }

  @action.bound
  async resolveUsingTheirs() {
    if (this.selectedFilePath) {
      await callMain(
        MESSAGES.VCS_RESOLE_USING_THEIR,
        this.project.projectPath,
        cleanLeadingSlashes(this.selectedFilePath)
      )
      await this.status()

      transaction(() => {
        this.originalFile = null
        this.modifiedFile = null
        this.selectedFilePath = null
        this.diffConflictedFile = false
      })
    }
  }

  @action.bound
  async resolveAsIs() {
    if (this.selectedFilePath && this.modifiedFile && this.modifiedFile.type === 'text') {
      await callMain(
        MESSAGES.VCS_RESOLE_AS_IS,
        this.project.projectPath,
        cleanLeadingSlashes(this.selectedFilePath),
        this.modifiedFile.content.getValue()
      )
      await this.status()

      transaction(() => {
        this.originalFile = null
        this.modifiedFile = null
        this.selectedFilePath = null
        this.diffConflictedFile = false
      })
    }
  }

  @action.bound
  async addRemote(name, url) {
    this.remotes = await callMain(MESSAGES.VCS_ADD_REMOTE, name, url)
  }

  @action.bound
  async deleteRemote(name) {
    this.remotes = await callMain(MESSAGES.VCS_DELETE_REMOTE, name)
  }

  @action.bound
  async push(remoteName, branch, userName, password) {
    this.emit('operation:begin', 'push')
    await callMain(MESSAGES.VCS_PUSH, this.project.projectPath, remoteName, branch, userName, password)

    await this.status()
    await this.getLog()

    this.emit('operation:finish', 'push')
  }

  @action.bound
  async fetch(remoteName, userName, password) {
    this.emit('operation:begin', 'fetch')
    await callMain(MESSAGES.VCS_FETCH, this.project.projectPath, remoteName, userName, password)

    await this.status()
    await this.getLog()

    this.emit('operation:finish', 'fetch')
  }

  @action.bound
  async pull(remoteName, userName, password) {
    this.emit('operation:begin', 'pull')

    await callMain(MESSAGES.VCS_PULL, this.project.projectPath, remoteName, userName, password)

    const mergingBranches = this.heads.reduce((acc, item) => {
      const { name, upstream, ahead, behind } = item

      if (upstream && (ahead || behind)) {
        return [...acc, [name, upstream.replace('refs/remotes/', '')]]
      }

      return acc
    }, [])

    console.log('MERGING PAIRS:', mergingBranches)

    for (const [ourBranchName, theirBranchName] of mergingBranches) {
      await callMain(MESSAGES.VCS_MERGE_BRANCHES, ourBranchName, theirBranchName)
    }

    await this.status()
    await this.getLog()

    this.emit('operation:finish', 'pull')
  }

  @action.bound
  async storeUserDetails(userName, email, useForAllRepositories = false) {
    transaction(() => {
      this.name = userName
      this.email = email
    })

    await callMain(MESSAGES.VCS_SET_USER_DEFAULTS, userName, email, useForAllRepositories)
  }

  @action.bound
  async clone(remoteUrl, targetFolder, userName, password) {
    this.emit('operation:begin', 'clone')
    await callMain(MESSAGES.VCS_CLONE_REPOSITORY, remoteUrl, targetFolder, userName, password)
    this.emit('operation:finish', 'clone')
  }

  @action.bound
  async init(folder) {
    await callMain(MESSAGES.VCS_INIT_REPOSITORY, folder)
  }

  @action.bound
  async getCommits(startIndex, endIndex) {
    return callMain(MESSAGES.VCS_GET_COMMIT_DIGEST, startIndex, endIndex)
  }
}