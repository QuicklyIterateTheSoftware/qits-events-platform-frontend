import { renderPayload } from './payload';

/**
 * The payload renderer, and mostly the payloads that are not what a renderer expects.
 *
 * The happy case is one line of `JSON.stringify`. What earns the file its tests is everything
 * around it: the column is nullable and permanently so, the service never parses what it stores,
 * and the hand-recorded write path accepts any string a person types — so "not JSON" is an ordinary
 * answer here, arriving from a route that exists for exactly that.
 */
describe('renderPayload', () => {
  it('pretty-prints at two spaces and sorts the keys', () => {
    const rendered = renderPayload('{"version":"2026.801.85149","branch":"main"}');

    expect(rendered).toEqual({
      kind: 'json',
      text: '{\n  "branch": "main",\n  "version": "2026.801.85149"\n}',
    });
  });

  it('sorts nested objects too, and never reorders an array', () => {
    // An object's key order carries no meaning and a canonical form has to fix one. An array's
    // order *is* the value: sorting it would change what the event said.
    const rendered = renderPayload('{"b":{"z":1,"a":2},"a":["z","a",{"y":1,"x":2}]}');

    expect(rendered).toMatchObject({
      kind: 'json',
      text: [
        '{',
        '  "a": [',
        '    "z",',
        '    "a",',
        '    {',
        '      "x": 2,',
        '      "y": 1',
        '    }',
        '  ],',
        '  "b": {',
        '    "a": 2,',
        '    "z": 1',
        '  }',
        '}',
      ].join('\n'),
    });
  });

  it('keeps a null value, because canonical JSON would have dropped it', () => {
    // The publisher omits nulls on the way out, so a null that reached here was typed by a person
    // and is the only thing on screen that says the key was named and left empty.
    expect(renderPayload('{"repository":null}')).toEqual({
      kind: 'json',
      text: '{\n  "repository": null\n}',
    });
  });

  it('gives the raw string back when it is not JSON, rather than failing', () => {
    expect(renderPayload('a note somebody typed')).toEqual({
      kind: 'raw',
      text: 'a note somebody typed',
    });
    expect(renderPayload('{"unclosed": ')).toMatchObject({ kind: 'raw' });
  });

  it('draws nothing for a null or blank payload', () => {
    expect(renderPayload(null)).toEqual({ kind: 'none' });
    expect(renderPayload('')).toEqual({ kind: 'none' });
    expect(renderPayload('   ')).toEqual({ kind: 'none' });
  });

  it('tells a payload of null from no payload at all', () => {
    // Four characters that parse to JSON's null is the publisher having sent null. An empty column
    // is nobody having sent anything. They draw differently because they are different.
    expect(renderPayload('null')).toEqual({ kind: 'json', text: 'null' });
  });

  it('renders a JSON value that is not an object', () => {
    // Nothing requires a payload to be an object; the service stores a string and reads nothing in
    // it. A renderer that assumed an object would fail on a payload the store accepts.
    expect(renderPayload('[1,2]')).toEqual({ kind: 'json', text: '[\n  1,\n  2\n]' });
    expect(renderPayload('"just a string"')).toEqual({ kind: 'json', text: '"just a string"' });
  });

  it('renders the live BuildSuccessful payload whole, with nothing truncated', () => {
    const live =
      '{"branch":"main","commitSha":"2633238c8828849df8f5fbc78e4838f21c1995be",' +
      '"finishedAt":"2026-08-01T06:32:26.546233489Z","repoId":"qits-spa-home",' +
      '"runId":"32acd2b9-38da-4d39-8481-1ae0abef7222"}';
    const rendered = renderPayload(live);

    // The largest payload on the live store is 220 bytes. Nothing here abbreviates a sha, elides a
    // key or offers a "show more": on a value this size that would be ceremony.
    expect(rendered.kind).toBe('json');
    expect(rendered).toMatchObject({
      text: expect.stringContaining('2633238c8828849df8f5fbc78e4838f21c1995be'),
    });
    expect(rendered).toMatchObject({ text: expect.stringContaining('"finishedAt"') });
  });
});
