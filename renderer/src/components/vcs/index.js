import React, { Component } from 'react'
import { observer, inject } from 'mobx-react'
import styled from 'styled-components'

import HistoryPage from './history-page'
import CommitPage from './commit-page'

const RootStyle = styled.div`
  height: 100%;
  width: 100%;
`

@observer
export class VCSView extends Component {
  render() {
    const { storage, workspace, onGitLogContextMenu, theme } = this.props

    if (storage.mode === 'log') {
      return (
        <RootStyle>
          <HistoryPage storage={storage} onContextMenu={onGitLogContextMenu} />
        </RootStyle>
      )
    } else if (storage.mode === 'commit') {
      return (
        <RootStyle>
          <CommitPage storage={storage} workspace={workspace} />
        </RootStyle>
      )
    }

    return null
  }
}
