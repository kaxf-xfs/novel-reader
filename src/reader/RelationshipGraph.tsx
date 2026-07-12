/** 增量 8 Task 8: 关系图 svg 组件。坐标完全来自 layoutFactionGraph 的纯函数
 * 输出。拖动只更新外层 <G transform>，不对每个节点单独 setState，避免大
 * cast 场景下逐节点重渲染。 */
import { useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import type { Character, Relation } from '../lib/ai/codex';
import { layoutFactionGraph } from '../lib/ai/factionLayout';

export interface RelationshipGraphProps {
  characters: Character[];
  relations: Relation[];
  width: number;
  height: number;
  onSelectCharacter: (name: string) => void;
}

const NODE_RADIUS = 14;

export function RelationshipGraph({ characters, relations, width, height, onSelectCharacter }: RelationshipGraphProps) {
  const { nodes, edges } = useMemo(
    () => layoutFactionGraph(characters, relations, { width, height }),
    [characters, relations, width, height],
  );

  // pan.current 是拖动偏移的唯一真源（无 stale-closure 风险，panResponder 只
  // create 一次）；panState 只是它的镜像，纯粹用来触发一次 re-render —— 直
  // 接 mutate ref 不会让 React 重绘 <G> 的 translateX/Y，图会看起来"卡住"。
  // gesture.dx/dy 是「本次手势」从按下到当前的累计增量，不是相邻两次 move
  // 之间的增量，所以每次新手势开始时（onPanResponderGrant）要把本次手势的
  // 基准 dragBase 设为上一次松手后提交的偏移，再在 move 里用
  // dragBase + gesture.dx/dy，而不是不断往 pan.current 上累加 dx/dy。
  const pan = useRef({ x: 0, y: 0 });
  const dragBase = useRef({ x: 0, y: 0 });
  const [panState, setPanState] = useState({ x: 0, y: 0 });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragBase.current = pan.current;
      },
      onPanResponderMove: (_evt, gesture) => {
        const next = { x: dragBase.current.x + gesture.dx, y: dragBase.current.y + gesture.dy };
        pan.current = next;
        setPanState(next);
      },
    }),
  ).current;

  // react-native-svg 的图形组件自带触摸事件（onPress），点击热区直接放在
  // Circle 上即可，不需要额外的 Pressable 包裹。
  return (
    <Svg testID="relationship-graph" width={width} height={height} {...panResponder.panHandlers}>
      <G translateX={panState.x} translateY={panState.y}>
        {edges.map((e) => (
          <Line
            key={`${e.from}-${e.to}-${e.kind}`}
            testID={`graph-edge-${e.from}-${e.to}-${e.kind}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke="rgba(127,127,127,0.5)"
            strokeWidth={1}
          />
        ))}
        {nodes.map((n) => (
          <G key={n.name} testID={`graph-node-${n.name}`} onPress={() => onSelectCharacter(n.name)}>
            <Circle cx={n.x} cy={n.y} r={NODE_RADIUS} fill="#83a99b" />
            <SvgText x={n.x} y={n.y + NODE_RADIUS + 12} fontSize={11} textAnchor="middle" fill="#7f838d">
              {n.name}
            </SvgText>
          </G>
        ))}
      </G>
    </Svg>
  );
}
