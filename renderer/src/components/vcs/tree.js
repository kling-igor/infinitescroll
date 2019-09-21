import React, { memo, useRef, useEffect } from 'react'
import styled from 'styled-components'
import { ROW_HEIGHT, X_STEP, Y_STEP } from './constants'

const LINE_WIDTH = 2
const COMMIT_RADIUS = 5

// TODO: высчитывать динамически в зависимости от максимального кол-ва || веток (процессинг только это покажет)
const CANVAS_WIDTH = 500

const NO_BRANCH_COLOR = '#a0a5a9'

const colors = [
  '#84b817',
  '#e32017',
  '#ee7c0e',
  '#ffd300',
  '#f3a9bb',
  '#b36305',
  '#00a4a7',
  '#00782a',
  '#003688',
  '#9b0056',
  '#95cdba'
]

const CanvasStyle = styled.canvas`
  z-index: 9999;
  position: absolute;
  left: 0px;
  top: 0px;
  pointer-events: none;
`

const branchColor = branch => colors[branch % 11] || 'black'

const yPositionForIndex = yIndex => (yIndex + 0.5) * Y_STEP

const xPositionForIndex = xIndex => (xIndex + 1) * X_STEP

const drawCommit = (ctx, topOffset, commit, yIndex) => {
  const { sha, offset, isHead, branch } = commit

  const x = xPositionForIndex(offset) // Positioning of commit circle
  const y = yPositionForIndex(yIndex) + topOffset
  const innerRadius = COMMIT_RADIUS - LINE_WIDTH - (!sha || isHead ? 1 : 0)

  ctx.fillStyle = !sha || isHead ? '#ffffff' : branchColor(branch)
  ctx.strokeStyle = sha ? branchColor(branch) : NO_BRANCH_COLOR
  ctx.lineWidth = !sha || isHead ? 8 : LINE_WIDTH * 2 - 1 // + (!sha ? 2 : 0)
  ctx.beginPath()
  ctx.arc(x, y, innerRadius, 0, 2 * Math.PI) // Draw a circle
  ctx.stroke() // Draw the outer line
  ctx.fill() // Fill the inner circle
}

const drawRoute = (ctx, topOffset, route, commit, yIndex) => {
  const { sha } = commit
  const [from, to, branch] = route

  // Starting position for route
  const fromX = xPositionForIndex(from)
  const fromY = yPositionForIndex(yIndex) + topOffset

  // Ending position for route
  const toX = xPositionForIndex(to)
  const toY = yPositionForIndex(yIndex + 1) + topOffset

  ctx.strokeStyle = sha ? branchColor(branch) : NO_BRANCH_COLOR // Gets a colour based on the branch no.
  ctx.lineWidth = LINE_WIDTH

  ctx.beginPath()
  ctx.moveTo(fromX, fromY) // Place the cursor at the start point

  if (fromX === toX) {
    ctx.lineTo(toX, toY) // Draw a line to the finish point
  } else {
    ctx.bezierCurveTo(fromX - X_STEP / 4, fromY + Y_STEP / 2, toX + X_STEP / 4, toY - Y_STEP / 2, toX, toY)
  }

  ctx.stroke()
}

const drawGraph = (ctx, topOffset, nodes) => {
  nodes.forEach((node, yIndex) => {
    // Draw the routes for this node
    node.routes.forEach(route => drawRoute(ctx, topOffset, route, node, yIndex))

    // Draw the commit on top of the routes
    drawCommit(ctx, topOffset, node, yIndex)
  })
}

/**
 *
 * @param {Number} scrollTop - смещение
 * @param {Number} height - видимая высота рисования
 * @param {Array} commits - данные для отображения
 */
export const Tree = memo(({ scrollTop, height, commits }) => {
  const canvasRef = useRef(null)
  let topOffset = 0
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, CANVAS_WIDTH, height)

    const skip = Math.floor(scrollTop / ROW_HEIGHT)
    const count = Math.floor(height / ROW_HEIGHT) + 2
    topOffset = -scrollTop % ROW_HEIGHT

    const drawingCommits = commits.slice(skip, skip + count)

    drawGraph(ctx, topOffset, drawingCommits) // тут имеет смысл передавать смещение и высчитанное кол-ов отображаемых коммитов чтобы не процессить ненужные
    // имеем смысл также не процессить каждый раз а только в тот момент когда в этом есть необходимость (поменялась структура дерева)
  }, [scrollTop, height, commits])

  // ширина может быть высчитанна в результате препроцессинга (для отображаемого диапазона может быть определено максимальное кол-во параллельно идущих веток)
  return <CanvasStyle ref={canvasRef} width={CANVAS_WIDTH} height={height} />
})
