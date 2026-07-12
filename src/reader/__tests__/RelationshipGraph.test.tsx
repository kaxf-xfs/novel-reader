import { fireEvent, render } from '@testing-library/react-native';
import { RelationshipGraph } from '../RelationshipGraph';

const characters = [
  { name: '甲', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 },
  { name: '乙', aliases: [], identity: [], groups: [{ name: '青云门', idx: 0 }], firstChapterIdx: 0 },
];
const relations = [{ from: '甲', to: '乙', kind: '同门', idx: 0 }];

describe('RelationshipGraph', () => {
  it('renders one node per character and calls onSelectCharacter when tapped', () => {
    const onSelectCharacter = jest.fn();
    const { getByTestId } = render(
      <RelationshipGraph characters={characters} relations={relations} width={300} height={300} onSelectCharacter={onSelectCharacter} />,
    );
    fireEvent.press(getByTestId('graph-node-甲'));
    expect(onSelectCharacter).toHaveBeenCalledWith('甲');
  });

  it('renders an edge for each relation between two rendered nodes', () => {
    const { getByTestId } = render(
      <RelationshipGraph characters={characters} relations={relations} width={300} height={300} onSelectCharacter={jest.fn()} />,
    );
    expect(getByTestId('graph-edge-甲-乙-同门')).toBeTruthy();
  });
});
