import React, { memo } from 'react'
import ResizeDetector from 'react-resize-detector'
import DiffEditor from '../diffeditor'

export const DiffPane = memo(({ originalFile = '', modifiedFile = '' }) => {
  console.log(originalFile)

  return (
    <ResizeDetector
      handleWidth
      handleHeight
      render={({ width, height }) => {
        return <DiffEditor width={width} height={height} originalFile={originalFile} modifiedFile="hello orlando!" />
      }}
    />
  )
})
