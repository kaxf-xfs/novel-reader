/** 增量 8 Task 8: 关系图 svg 组件。坐标完全来自 layoutFactionGraph 的纯函数
 * 输出。拖动只更新外层 <G transform>，不对每个节点单独 setState，避免大
 * cast 场景下逐节点重渲染。 */
import { useMemo, useRef } from 'react';
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

  const pan = useRef({ x: 0, y: 0 });
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        pan.current = { x: pan.current.x + gesture.dx, y: pan.current.y + gesture.dy };
      },
    }),
  ).current;

  // react-native-svg 的图形组件自带触摸事件（onPress），点击热区直接放在
  // Circle 上即可，不需要额外的 Pressable 包裹。
  return (
    <Svg testID="relationship-graph" width={width} height={height} {...panResponder.panHandlers}>
      <G translateX={pan.current.x} translateY={pan.current.y}>
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
