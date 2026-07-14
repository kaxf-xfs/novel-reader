/** 增量 8.5: 人物卡内嵌的小型「以我为中心」关系图，替代整体网状图组件。
 * ≤8 个直接关系节点，纯固定几何，无需碰撞检测/拖动/缩放。 */
import React, { useMemo } from 'react';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import type { Character, Relation } from '../lib/ai/codex';
import { egoNetwork } from '../lib/ai/codexRelations';

export interface EgoGraphProps {
  focalName: string;
  characters: Character[];
  relations: Relation[];
  width: number;
  height: number;
  onSelectCharacter: (name: string) => void;
}

const NODE_RADIUS = 12;
const FOCAL_RADIUS = 16;

export function EgoGraph({ focalName, characters, relations, width, height, onSelectCharacter }: EgoGraphProps) {
  const { nodes, edges } = useMemo(
    () => egoNetwork(focalName, characters, relations, { width, height }),
    [focalName, characters, relations, width, height],
  );

  return (
    <Svg testID="ego-graph" width={width} height={height}>
      {edges.map((e) => (
        <Line
          key={`${e.x2}-${e.y2}-${e.kind}`}
          testID={`ego-edge-${nodes.find((n) => n.x === e.x2 && n.y === e.y2)?.name ?? ''}-${e.kind}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke="rgba(127,127,127,0.5)"
          strokeWidth={1}
        />
      ))}
      {nodes.map((n) => (
        <React.Fragment key={n.name}>
          <Circle
            testID={`ego-node-${n.name}`}
            cx={n.x}
            cy={n.y}
            r={n.focal ? FOCAL_RADIUS : NODE_RADIUS}
            fill={n.focal ? '#b0674a' : '#83a99b'}
            onPress={() => onSelectCharacter(n.name)}
          />
          <SvgText x={n.x} y={n.y + (n.focal ? FOCAL_RADIUS : NODE_RADIUS) + 12} fontSize={11} textAnchor="middle" fill="#7f838d">
            {n.name}
          </SvgText>
        </React.Fragment>
      ))}
    </Svg>
  );
}
