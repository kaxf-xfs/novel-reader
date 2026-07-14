import type { Character, Term } from '../codex';
import { characterFragmentHash, isCharacterDirty, isTermDirty, termFragmentHash } from '../codexPolish';

function char(over: Partial<Character>): Character {
  return { name: 'X', aliases: [], identity: [], groups: [], firstChapterIdx: 0, ...over };
}

function term(over: Partial<Term>): Term {
  return { name: 'T', category: '其它', def: [], firstChapterIdx: 0, ...over };
}

describe('characterFragmentHash', () => {
  it('is order-independent: same fragments in a different array order produce the same hash', () => {
    const a = char({
      identity: [{ text: 'A', idx: 1 }, { text: 'B', idx: 2 }],
      origin: [{ text: 'C', idx: 3 }],
      events: [{ text: 'D', idx: 4 }],
    });
    const b = char({
      identity: [{ text: 'B', idx: 2 }, { text: 'A', idx: 1 }],
      origin: [{ text: 'C', idx: 3 }],
      events: [{ text: 'D', idx: 4 }],
    });
    expect(characterFragmentHash(a)).toBe(characterFragmentHash(b));
  });

  it('changes when any fed field (identity/origin/events) changes', () => {
    const base = char({ identity: [{ text: 'A', idx: 1 }] });
    const changed = char({ identity: [{ text: 'A', idx: 1 }, { text: 'NEW', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changed));
    const changedOrigin = char({ identity: [{ text: 'A', idx: 1 }], origin: [{ text: 'NEW-ORIGIN', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changedOrigin));
    const changedEvents = char({ identity: [{ text: 'A', idx: 1 }], events: [{ text: 'NEW-EVENT', idx: 5 }] });
    expect(characterFragmentHash(base)).not.toBe(characterFragmentHash(changedEvents));
  });
});

describe('termFragmentHash', () => {
  it('is order-independent and changes when def changes', () => {
    const a = term({ def: [{ text: 'A', idx: 1 }, { text: 'B', idx: 2 }] });
    const b = term({ def: [{ text: 'B', idx: 2 }, { text: 'A', idx: 1 }] });
    expect(termFragmentHash(a)).toBe(termFragmentHash(b));
    const changed = term({ def: [{ text: 'A', idx: 1 }, { text: 'C', idx: 3 }] });
    expect(termFragmentHash(a)).not.toBe(termFragmentHash(changed));
  });
});

describe('isCharacterDirty / isTermDirty', () => {
  it('a character with no bioHash yet is dirty by definition', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    expect(isCharacterDirty(c)).toBe(true);
  });

  it('a character whose bioHash matches its current fragment hash is clean', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    const withHash: Character = { ...c, bioHash: characterFragmentHash(c) };
    expect(isCharacterDirty(withHash)).toBe(false);
  });

  it('a character whose fragments changed after bioHash was set becomes dirty again', () => {
    const c = char({ identity: [{ text: 'A', idx: 1 }] });
    const withHash: Character = { ...c, bioHash: characterFragmentHash(c) };
    const mutated: Character = { ...withHash, identity: [...withHash.identity, { text: 'NEW', idx: 9 }] };
    expect(isCharacterDirty(mutated)).toBe(true);
  });

  it('a term with no glossHash yet is dirty; matching glossHash is clean; changed def is dirty again', () => {
    const t = term({ def: [{ text: 'A', idx: 1 }] });
    expect(isTermDirty(t)).toBe(true);
    const withHash: Term = { ...t, glossHash: termFragmentHash(t) };
    expect(isTermDirty(withHash)).toBe(false);
    const mutated: Term = { ...withHash, def: [...withHash.def, { text: 'NEW', idx: 9 }] };
    expect(isTermDirty(mutated)).toBe(true);
  });
});
