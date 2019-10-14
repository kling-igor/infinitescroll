import React, { memo } from 'react'
import ResizeDetector from 'react-resize-detector'
import styled, { withTheme } from 'styled-components'
import { ImageViewer } from '../imageviewer'
import DiffEditor from '../diffeditor'

const RootContainerStyle = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
`

const BinaryDataPaneStyle = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  color: ${({ theme: { type } }) => (type === 'dark' ? '#ffffffaa' : '#000000aa')};
  padding-top: 8px;
  user-select: none;
`

const PaneSplitter = styled.div`
  width: 2px;
  height: 100%;
  display: flex;
  background-color: gray;
`

const BinaryDataDiff = memo(
  withTheme(() => {
    return (
      <RootContainerStyle>
        <BinaryDataPaneStyle>Binary Data</BinaryDataPaneStyle>
        <PaneSplitter />
        <BinaryDataPaneStyle>Binary Data</BinaryDataPaneStyle>
      </RootContainerStyle>
    )
  })
)

const ImageDiff = memo(({ original, modified }) => {
  return (
    <RootContainerStyle>
      <ImageViewer src={original.content} />
      <PaneSplitter />
      <ImageViewer src={modified.content} />
    </RootContainerStyle>
  )
})

export const DiffPane = memo(({ originalFile, modifiedFile, textEditorDidMount }) => {
  if (!originalFile && !modifiedFile) return null

  if (originalFile.type === 'text' && modifiedFile.type === 'text') {
    return (
      <ResizeDetector
        handleWidth
        handleHeight
        refreshMode="debounce"
        refreshRate={500}
        render={({ width, height }) => (
          <DiffEditor
            width={width}
            height={height}
            originalFile={originalFile}
            modifiedFile={modifiedFile}
            textEditorDidMount={textEditorDidMount}
          />
        )}
      />
    )
  } else if (originalFile.type === 'image' && modifiedFile.type === 'image') {
    return <ImageDiff original={originalFile.path} modified={modifiedFile.path} />
  }

  return <BinaryDataDiff />
})
