import { SUMMARISED_NAMES, rowGist } from './event-summary';

/**
 * The row summaries, against the payloads the live store actually holds.
 *
 * Two of these matter more than the rest and are the ones to keep if the file is ever trimmed: the
 * repository is read from **both** of the keys the platform spells it with, and a name this build
 * has never heard of still renders something true. New event types are born in a Java service and
 * in no SPA's release cycle, so the fallback is what keeps the log legible on the day a fourth one
 * first fires.
 */
describe('rowGist', () => {
  const gist = (name: string, payload: unknown, description: string | null = null) =>
    rowGist({
      name,
      payload: typeof payload === 'string' || payload === null ? payload : JSON.stringify(payload),
      description,
    });

  it('names the three it knows by heart, and no more', () => {
    expect(SUMMARISED_NAMES).toEqual(['BuildSuccessful', 'SCMRelease', 'SoftwareRelease']);
  });

  it('reads a build’s repository from repoId, and abbreviates its sha as git does', () => {
    expect(
      gist('BuildSuccessful', {
        branch: 'main',
        commitSha: 'a35289326fbb2c1f5b9a0e7d4c3b2a19',
        finishedAt: '2026-08-01T08:52:29Z',
        repoId: 'qits-spa-home',
        runId: '9f0c',
      }),
    ).toEqual({ repository: 'qits-spa-home', summary: 'main · a352893' });
  });

  it('reads a release’s repository from the other key entirely', () => {
    expect(
      gist('SCMRelease', {
        branch: 'main',
        projectId: 'qits',
        repository: 'qits-spa-ui-components',
        version: '2026.801.85149',
      }),
    ).toEqual({ repository: 'qits-spa-ui-components', summary: '2026.801.85149 · main' });
  });

  it('says which package a software release published, type first', () => {
    expect(
      gist('SoftwareRelease', {
        packageName: '@qits/ui-components',
        packageType: 'npm',
        repository: 'qits-spa-ui-components',
        version: '2026.801.85149',
      }),
    ).toEqual({
      repository: 'qits-spa-ui-components',
      summary: '2026.801.85149 · npm @qits/ui-components',
    });
  });

  it('draws what a known name has when its payload is missing a key', () => {
    expect(gist('BuildSuccessful', { repoId: 'qits-stt' })).toEqual({
      repository: 'qits-stt',
      summary: '—',
    });
  });

  it('renders a name it has never heard of as its first three keys, in order', () => {
    expect(gist('ProbeEvent', { zeta: 3, alpha: 'a', beta: true, delta: 'd' })).toEqual({
      repository: null,
      summary: 'alpha=a · beta=true · delta=d',
    });
  });

  it('still finds the repository of an unknown name, and does not repeat it in the pairs', () => {
    expect(gist('SomethingElseEntirely', { repository: 'qits-stt', tag: 'v1', who: 'me' })).toEqual(
      {
        repository: 'qits-stt',
        summary: 'tag=v1 · who=me',
      },
    );
  });

  it('says a payload is not JSON rather than drawing a blank row', () => {
    expect(gist('ProbeEvent', 'not json at all')).toEqual({
      repository: null,
      summary: 'payload is not JSON',
    });
  });

  it('falls back to the description, which is what the hand-recorded path writes', () => {
    expect(gist('ProbeEvent', null, 'a probe recorded by hand')).toEqual({
      repository: null,
      summary: 'a probe recorded by hand',
    });
  });

  it('draws an em dash when the event carries nothing at all', () => {
    expect(gist('ProbeEvent', null)).toEqual({ repository: null, summary: '—' });
  });
});
