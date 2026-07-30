# Workspace initial-placement regression

## Fixed point

The known-good implementation is Workspace v6 at commit `2f0a42e`.
Workspace v9 is the implementation under review.

## User-visible requirement

When the user activates **Workspace**, newly created terminals must appear
directly in their assigned 3-by-2 grid cells. They must not first be drawn
stacked at the desktop centre and then visibly move into place.

## Existing Workspace invariants

1. Terminal identity is proved by the exact fixed process command; a title
   alone is not sufficient.
2. Existing unique terminal sessions are preserved, and only missing slots are
   created.
3. The grid derives from the work area supplied by each adapter. On the
   current single-monitor setup, GNOME's current-monitor work area and X11's
   `_NET_WORKAREA` describe the same visible area. X11/Ptyxis shadow
   compensation is an adapter detail and must not change the visible grid.
4. A panel activation holds newly created window actors until the complete set
   is ready, then reveals them together immediately before redraw.
5. Failure is visibility-safe: no terminal may remain permanently transparent.
6. Timeout or partial-creation failure rolls back only sessions created by the
   current activation.
7. Panel placement retains the narrow event-driven legacy AppIndicator
   appearance/visibility listener added by the v7 hardening. It must not grow
   into broad reparenting or periodic polling.

## Acceptance criteria

1. Before a new terminal can produce a visible frame, its frame rectangle is
   already the canonical rectangle for its slot.
2. Initial placement and final X11 reconciliation use one canonical grid
   calculation, exposed through separate GNOME Shell and X11 adapters.
3. If a compositor actor is not yet available, synchronous frame placement is
   still attempted; hiding may fail open, but centred default placement must
   not be the fallback.
4. The direct helper continues to recall and arrange a complete existing set.
5. Pure layout and pre-paint ordering are regression-tested without controlling
   the user's live desktop.
6. A terminal process whose Mutter-managed window has not appeared yet remains
   pending until the activation deadline. Duplicate identities and failed
   probes still fail closed.
