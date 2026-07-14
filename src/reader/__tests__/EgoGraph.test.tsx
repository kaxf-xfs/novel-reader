import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import type { Character, Relation } from '../../lib/ai/codex';
import { EgoGraph } from '../EgoGraph';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('EgoGraph', () => {
  const characters = [char({ name: '张三' }), char({ name: '李四' })];
  const relations: Relation[] = [{ from: '张三', to: '李四', kind: '师徒', idx: 1 }];

  it('renders a node for the focal character and its direct relation', () => {
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('ego-node-张三')).toBeTruthy();
    expect(getByTestId('ego-node-李四')).toBeTruthy();
  });

  it('renders an edge for the relation', () => {
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('ego-edge-李四-师徒')).toBeTruthy();
  });

  it('tapping a node calls onSelectCharacter with that name', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <EgoGraph focalName="张三" characters={characters} relations={relations} width={200} height={200} onSelectCharacter={onSelect} />,
    );
    fireEvent.press(getByTestId('ego-node-李四'));
    expect(onSelect).toHaveBeenCalledWith('李四');
  });
});
