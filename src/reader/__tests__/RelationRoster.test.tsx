import { fireEvent } from '@testing-library/react-native';
import React from 'react';

import type { Character, Relation } from '../../lib/ai/codex';
import { renderWithSettings } from '../../test-utils/render';
import { RelationRoster } from '../RelationRoster';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

describe('RelationRoster', () => {
  const characters = [
    char({ name: '张三', groups: [{ name: '青云门', idx: 1 }] }),
    char({ name: '李四', groups: [{ name: '青云门', idx: 1 }] }),
    char({ name: '赵六', groups: [{ name: '散修', idx: 1 }] }),
  ];
  const relations: Relation[] = [
    { from: '张三', to: '李四', kind: '师徒', idx: 2 },
    { from: '张三', to: '赵六', kind: '仇敌', idx: 3 },
  ];

  it('renders section headers for each group', () => {
    const { getByText } = renderWithSettings(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={jest.fn()} />,
    );
    expect(getByText('青云门')).toBeTruthy();
    expect(getByText('散修')).toBeTruthy();
  });

  it('renders each character name once', () => {
    const { getByText } = renderWithSettings(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={jest.fn()} />,
    );
    expect(getByText('张三')).toBeTruthy();
    expect(getByText('李四')).toBeTruthy();
    expect(getByText('赵六')).toBeTruthy();
  });

  it('renders a tappable chip for a non-tree/cross-group relation, and tapping it selects that character', () => {
    const onSelect = jest.fn();
    const { getByTestId } = renderWithSettings(
      <RelationRoster characters={characters} relations={relations} onSelectCharacter={onSelect} />,
    );
    fireEvent.press(getByTestId('roster-chip-张三-赵六-仇敌'));
    expect(onSelect).toHaveBeenCalledWith('赵六');
  });
});
