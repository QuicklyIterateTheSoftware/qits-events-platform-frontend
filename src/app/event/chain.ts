import { Injectable, inject } from '@angular/core';
import type { EventDto } from '../api/dto';
import { sortNewestFirst } from '../api/event-order';
import { EventsApi } from '../api/events-api';
import { statusOf } from '../ui/loadable';

/**
 * The chain: what caused this event, and what it caused, as one graph.
 *
 * **The client bounds its own walk, because the service refuses to.** There is no `/chain` route,
 * no depth parameter and no graph endpoint, and that is a standing decision rather than a gap — the
 * service's README, its DTO and its controller all say the same sentence: a chain-walking client
 * bounds its own depth and remembers the ids it has visited. This file is that sentence.
 *
 * **The walk is up, then down from where it stopped.** Upwards is `GET /{id}` following `parentId`,
 * one hop at a time, because an event knows only its own cause. Downwards is `?parentId=`,
 * breadth-first from the root, one call per node — which is why the fork renders *as* a fork:
 * `parentId` is single-valued, so the thing below the root is a tree and its branches are the
 * information. Today's live shape is one `SCMRelease` becoming a `BuildSuccessful` and a
 * `SoftwareRelease` at the same microsecond, and no arrangement of click-through pages shows that.
 *
 * **Cost is `U + D`**: `U` hops up, one request each, and `D` nodes expanded downwards, one request
 * each. The page adds its own `1` for the event it arrived at, which this walker never fetches —
 * it is handed the event, so the `1` stays visibly the page's and the caps stay visibly this
 * file's. Measured on the live store: a childless root is `0 + 1`, and the five-node npm release
 * train entered from its deepest leaf is `2 + 5`.
 *
 * **Three caps, and every one of them draws a row when it is reached.** Nothing here truncates in
 * silence: a bounded branch says the walk stopped and says why, which is what makes a small tree
 * readable as "this is all of it" rather than "this is all it showed me".
 *
 * - {@link UP_HOP_CAP} — 32 requests upwards.
 * - {@link DOWN_DEPTH_CAP} — 8 levels below the root.
 * - {@link DOWN_NODE_CAP} — 200 events in the drawn graph.
 *
 * They are roughly twenty times the largest graph the platform has produced in its lifetime, and
 * they exist because nothing server-side prevents a cycle: a conditional trigger that fires
 * sometimes can produce `A → B → A`, and this graph is the platform's only runtime detector for it.
 * A seen-set guards both walks, so a loop stops the walk and is drawn rather than hanging the page.
 *
 * **A parent that answers 404 is data, not damage.** One live row needs it today: `59934bf8` names
 * `064158b0` as its cause and that row was deleted on purpose by a migration which recorded the
 * reading this file implements — the surviving child *becomes a chain start*. So a 404 walking up
 * ends the walk with {@link ChainStart} `dangling` and the tree draws normally underneath. It is
 * never an error, never a spinner and never a blank.
 *
 * **`?parentId=` cannot tell "caused nothing" from "no such event".** Both answer 200 with an empty
 * list, for any id, including one that is not a UUID. So an empty children list ends a branch and
 * means nothing more than that; nothing here may read it as a missing event.
 *
 * A failure that is *not* a 404 walking up, and any failure walking down, rejects the whole walk.
 * The chain is one panel with one state: the header and the payload beside it stay on screen, and
 * the panel offers a retry. Half a graph drawn as if it were whole would be the one dishonest
 * outcome available here.
 */

/** Requests spent walking up before the walk stops and says it was bounded. */
export const UP_HOP_CAP = 32;

/** Levels drawn below the root. The deepest live component is 2. */
export const DOWN_DEPTH_CAP = 8;

/** Events drawn in one graph. The largest live component is 5. */
export const DOWN_NODE_CAP = 200;

/**
 * Where the chain begins, and why the walk upwards stopped there.
 *
 * `root` is the ordinary answer: `parentId` was null and this event was caused by nothing the log
 * knows about. The other three are all "the walk stopped before it found one", and the page draws
 * each of them as a statement above the tree rather than as an error beside it.
 */
export type ChainStart =
  /** `parentId` was null. A genuine root. */
  | { readonly kind: 'root' }
  /** The cause is not in the log — deleted, or published after its child and never at all. */
  | { readonly kind: 'dangling'; readonly parentId: string }
  /** The cause is an event already on this walk. Nothing server-side prevents that. */
  | { readonly kind: 'cycle'; readonly parentId: string }
  /** 32 hops and still not a root. */
  | { readonly kind: 'capped'; readonly parentId: string };

/**
 * One drawn line of the graph, in pre-order — a node, then its subtree, then whatever the walk did
 * not ask about beneath it.
 *
 * `depth` is levels below the root and is what the page indents by. A marker sits at the depth its
 * missing subtree would have occupied, which is what makes "the walk stopped here" point at a place
 * rather than at the page.
 */
export type ChainRow =
  /** An event. `current` is the one the reader arrived at. */
  | {
      readonly kind: 'event';
      readonly depth: number;
      readonly event: EventDto;
      readonly current: boolean;
    }
  /** A child already drawn above: the graph loops back on itself here. */
  | { readonly kind: 'loop'; readonly depth: number; readonly id: string }
  /** The depth cap: this branch reaches {@link DOWN_DEPTH_CAP} and was not walked further. */
  | { readonly kind: 'bound'; readonly depth: number };

/** One walked graph, ready to draw. */
export interface Chain {
  /** Where it begins, and why the walk upwards stopped. */
  readonly start: ChainStart;
  /** The whole graph, pre-order, root first. Never empty: the root is always a row. */
  readonly rows: readonly ChainRow[];
  /**
   * The node cap ended the walk: this graph holds more than {@link DOWN_NODE_CAP} events.
   *
   * **It is one statement about the walk and not a marker per node**, unlike the depth cap. A depth
   * bound is a fact about one branch and belongs beside it; the node cap is reached at a frontier
   * that may be a hundred nodes wide, and drawing "stopped here" against every one of them would
   * bury the tree it is describing under a report about itself.
   */
  readonly capped: boolean;
  /**
   * What the walk cost — `U + D`, and the page's own fetch is not in it.
   *
   * It is a number rather than a comment because the budget is this page's central design claim.
   * A spec asserts it directly, and the page prints it, so a walk that quietly grew a request would
   * be visible on screen rather than only in a network panel nobody has open.
   */
  readonly requests: number;
}

/** A node being built. `children` fills level by level; the markers fill when a cap is met. */
interface Building {
  readonly event: EventDto;
  readonly children: Building[];
  /** Child ids already drawn elsewhere in this graph. */
  readonly loops: string[];
  /** Set when this node sits at the depth cap, so its children were never asked for. */
  bound: boolean;
}

@Injectable({ providedIn: 'root' })
export class ChainWalker {
  private readonly api = inject(EventsApi);

  /**
   * The whole component around one event.
   *
   * The event is passed in rather than fetched: the page already has it, and re-reading it would
   * buy nothing but a request the budget would have to explain.
   */
  async walk(event: EventDto): Promise<Chain> {
    const up = await this.walkUp(event);
    const down = await this.walkDown(up.root);
    return {
      start: up.start,
      rows: flatten(down.root, 0, event.id),
      capped: down.capped,
      requests: up.hops + down.expanded,
    };
  }

  /**
   * Up by `parentId` to the root, one request per hop.
   *
   * The seen-set holds every id on the path, so a cycle is caught by the id and not by the hop
   * count — `A → B → A` stops after one hop rather than after 32, and says it looped.
   */
  private async walkUp(
    from: EventDto,
  ): Promise<{ root: EventDto; start: ChainStart; hops: number }> {
    const seen = new Set<string>([from.id]);
    let node = from;
    let hops = 0;
    for (;;) {
      const parentId = node.parentId;
      if (parentId === null) {
        return { root: node, start: { kind: 'root' }, hops };
      }
      if (seen.has(parentId)) {
        return { root: node, start: { kind: 'cycle', parentId }, hops };
      }
      if (hops >= UP_HOP_CAP) {
        return { root: node, start: { kind: 'capped', parentId }, hops };
      }
      hops += 1;
      let parent: EventDto;
      try {
        parent = await this.api.get(parentId);
      } catch (error) {
        if (statusOf(error) === 404) {
          return { root: node, start: { kind: 'dangling', parentId }, hops };
        }
        throw error;
      }
      seen.add(parent.id);
      node = parent;
    }
  }

  /**
   * Down from the root by `?parentId=`, breadth-first, one request per node.
   *
   * Breadth-first and a level at a time, so the requests of one level go out together: the shape is
   * the same as one-at-a-time and a five-node graph costs two round trips rather than five. The
   * *rendering* order is depth-first, which {@link flatten} does at the end — a subtree has to read
   * as a subtree, and the order the answers arrived in is not that.
   *
   * Children arrive newest first by `occurredAt` alone, which is not a total order on this data: a
   * fork's siblings share the run's finish instant to the microsecond. {@link sortNewestFirst} is
   * the app's one order and it breaks that tie by id, so two walks of one graph draw it the same
   * way round.
   */
  private async walkDown(
    root: EventDto,
  ): Promise<{ root: Building; expanded: number; capped: boolean }> {
    const seen = new Set<string>([root.id]);
    const built: Building = { event: root, children: [], loops: [], bound: false };
    let level: Building[] = [built];
    let depth = 0;
    let expanded = 0;
    let capped = false;

    while (level.length > 0) {
      if (depth >= DOWN_DEPTH_CAP) {
        for (const node of level) {
          node.bound = true;
        }
        break;
      }
      if (seen.size >= DOWN_NODE_CAP) {
        capped = true;
        break;
      }

      const answers = await Promise.all(level.map((node) => this.api.children(node.event.id)));
      expanded += level.length;
      const next: Building[] = [];

      level.forEach((parent, index) => {
        for (const child of sortNewestFirst(answers[index])) {
          if (seen.has(child.id)) {
            parent.loops.push(child.id);
            continue;
          }
          if (seen.size >= DOWN_NODE_CAP) {
            capped = true;
            continue;
          }
          seen.add(child.id);
          const node: Building = { event: child, children: [], loops: [], bound: false };
          parent.children.push(node);
          next.push(node);
        }
      });

      depth += 1;
      level = next;
    }

    return { root: built, expanded, capped };
  }
}

/**
 * The built tree as drawn lines, pre-order: a node, its subtree, then the two markers for what was
 * not drawn beneath it.
 *
 * The recursion is bounded by {@link DOWN_DEPTH_CAP}, so it is eight frames at the worst and needs
 * no explicit stack.
 */
function flatten(node: Building, depth: number, currentId: string): readonly ChainRow[] {
  const rows: ChainRow[] = [
    { kind: 'event', depth, event: node.event, current: node.event.id === currentId },
  ];
  for (const child of node.children) {
    rows.push(...flatten(child, depth + 1, currentId));
  }
  for (const id of node.loops) {
    rows.push({ kind: 'loop', depth: depth + 1, id });
  }
  if (node.bound) {
    rows.push({ kind: 'bound', depth: depth + 1 });
  }
  return rows;
}
