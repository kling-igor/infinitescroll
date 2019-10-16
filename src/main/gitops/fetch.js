import nodegit from 'nodegit'

// TODO: нужно предоставлять выбор ветки которую нужно тянуть
// делать это через контекстное меню веток

export async function fetch(repo, remoteName, username, password) {
  console.log('FETCH...')

  let attepmpt = 0

  const remoteCallbacks = {
    certificateCheck: () => 0,
    credentials: (url, userName) => {
      // console.log('CRED URL:', url)
      // console.log('CRED USERNAME:', userName)

      if (attepmpt++ < 5) {
        return username && password ? nodegit.Cred.userpassPlaintextNew(username, password) : nodegit.Cred.defaultNew()
      }

      throw new Error('auth failed')
    }
  }

  const remote = await repo.getRemote(remoteName)

  try {
    await remote.connect(nodegit.Enums.DIRECTION.FETCH, remoteCallbacks)

    const connected = remote.connected()
    console.log('CONNECTED:', connected)

    const remoteRefs = await remote.referenceList()
    console.log('REMOTE BRANCHES:', remoteRefs.map(item => item.name()))

    await remote.download(null)

    const defaultBranch = await remote.defaultBranch()
    console.log('defaultBranch:', defaultBranch)

    await remote.disconnect()
  } catch (e) {
    console.log('CONNECTION ERROR:', e.message)

    if (e.message.includes('unexpected HTTP status code:')) {
      console.log('CHECK CONNECTION...')
      throw new Error('Connection error')
    }

    if (e.message.includes('credentials callback returned an invalid cred type')) {
      console.log('AUTH REQUIRED')
      throw new Error('Auth required')
    }

    if (e.message.includes('Method connect has thrown an error.')) {
      console.log('AUTH FAILED')
      throw new Error('Auth failed')
    }
  }

  attepmpt = 0

  try {
    console.log('FETCHING!!!!')
    await repo.fetch(remoteName, {
      downloadTags: 1,
      prune: 1,
      updateFetchhead: 1,
      fetchOpts: {
        callbacks: {
          // github will fail cert check on some OSX machines, this overrides that check
          certificateCheck: () => 0,
          credentials: (url, userName) => {
            // console.log('CRED URL:', url)
            // console.log('CRED USERNAME:', userName)

            if (attepmpt++ < 5) {
              return username && password
                ? nodegit.Cred.userpassPlaintextNew(username, password)
                : nodegit.Cred.defaultNew()
            }

            throw new Error('auth failed')
          }
        }
      }
    })
  } catch (e) {
    console.log('FETCH ERROR:', e)
    if (e.message.includes('unexpected HTTP status code:')) {
      console.log('CHECK CONNECTION...')
      throw new Error('Connection error')
    }

    if (e.message.includes('credentials callback returned an invalid cred type')) {
      console.log('AUTH REQUIRED')
      throw new Error('Auth required')
    }

    if (e.message.includes('Method connect has thrown an error.')) {
      console.log('AUTH FAILED')
      throw new Error('Auth failed')
    }
  }
}