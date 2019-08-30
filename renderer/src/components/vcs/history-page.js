/**
 * Отображение gitlog
 */
const { remote } = window.require('electron')

import React, { Component } from 'react'
import { observer, inject } from 'mobx-react'
import SplitPane, { Pane } from '../react-split'
import { DiffPane } from './diff-pane'
import { History } from './history'

@observer
class HistoryPage extends Component {
  state = {
    layout: ['20000', '20000']
  }

  setLayout = layout => {
    this.setState({ layout })
  }

  onContextMenu = sha => {
    if (!sha) return

    const {
      storage: { currentCommit },
      workspace
    } = this.props

    // TODO: в VCS добавить знание о текущем коммите рабочего каталога

    workspace.showContextMenu({
      items: [
        {
          label: 'Checkout...',
          click: () => {}
        },
        {
          label: 'Merge...',
          click: () => {}
        },
        {
          label: 'Rebase...',
          click: () => {}
        },
        {
          type: 'separator'
        },
        {
          label: 'Tag...',
          click: () => {}
        },
        {
          label: 'Branch...',
          click: () => {}
        },
        {
          label: 'Reset master to this commit',
          click: () => {}
        },
        {
          label: 'Reverse commit...',
          click: () => {}
        },
        {
          type: 'separator'
        },
        {
          label: 'Copy SHA-1 to Clipboard',
          click: () => {}
        }
      ]
    })
  }

  // может быть инициировано из модели!!!
  confirmBranchSwitch(sha, workdirIsClean, branchName) {
    let message = ''
    let detail = ''

    if (branchName && branchName !== 'HEAD') {
      message = `Confirm Branch Switch`
      detail = `Are you sure you want to switch your working copy to the branch '${branchName}'?`
    } else {
      message = `Confirm change working copy`
      detail = `Are you sure you want to checkout '${sha}'? Doing so will make your working copy a 'detached HEAD', which means you won't be on a branch anymore. If you want to commit after this you'll probably want to either checkout a branch again, or create a new branch. Is this ok?`
    }

    return new Promise((resolve, reject) => {
      remote.dialog.showMessageBox(
        {
          type: 'question',
          message,
          detail,
          buttons: ['OK', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          checkboxLabel: workdirIsClean ? '' : 'Discard local changes'
          // icon: warningIcon
        },
        (index, checkboxChecked) => {
          if (index === 0) {
            resolve({ discardLocalChanges: !!checkboxChecked })
          } else {
            reject()
          }
        }
      )
    })
  }

  render() {
    const upperSize = +this.state.layout[0] / 100
    const lowerSize = +this.state.layout[1] / 100

    const {
      commits,
      commiters,
      heads,
      remoteHeads,
      tags,
      originalFile,
      modifiedFile,
      onCommitSelect,
      selectedCommit
    } = this.props.storage

    return (
      <SplitPane split="horizontal" allowResize resizersSize={0} onResizeEnd={this.setLayout}>
        <Pane size={upperSize} minSize="50px" maxSize="100%">
          <History
            commits={commits}
            commiters={commiters}
            heads={heads}
            remoteHeads={remoteHeads}
            tags={tags}
            onCommitSelect={onCommitSelect}
            onContextMenu={this.onContextMenu}
            selectedCommit={selectedCommit}
          />
        </Pane>
        <Pane size={lowerSize} minSize="50px" maxSize="100%">
          <DiffPane originalFile={originalFile} modifiedFile={modifiedFile} />
        </Pane>
      </SplitPane>
    )
  }
}

export default HistoryPage
