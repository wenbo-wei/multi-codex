import {workspaceFrameForSlot} from './workspaceLayout.mjs';


function applyFrame(window, target) {
    window.move_frame(true, target.x, target.y);
    window.move_resize_frame(
        true,
        target.x,
        target.y,
        target.width,
        target.height
    );
}


function holdActor(actor) {
    actor.remove_all_transitions();
    actor.set_opacity(0);
}


function revealActor(actor) {
    try {
        actor.remove_all_transitions();
    } catch {
        // Opacity restoration must still be attempted.
    }
    try {
        actor.set_opacity(255);
    } catch {
        // The actor may already have been disposed.
    }
}


export function prepareTerminalWindow({
    actor,
    skipNextEffect,
    slot,
    window,
}) {
    const target = workspaceFrameForSlot(
        window.get_work_area_current_monitor(),
        slot
    );

    // Placement is synchronous and does not depend on a compositor actor.
    // This is the visibility-safe fallback if the actor is unexpectedly late.
    applyFrame(window, target);

    if (actor) {
        try {
            if (typeof skipNextEffect !== 'function')
                throw new TypeError(
                    'skipNextEffect is required when actor exists'
                );
            skipNextEffect(actor);
            holdActor(actor);
        } catch (error) {
            revealActor(actor);
            throw error;
        }
    }
    return {actor, target, window};
}


export function reassertTerminalWindow(placement) {
    if (!placement?.window || !placement?.target)
        throw new TypeError('a prepared terminal placement is required');
    if (placement.actor)
        holdActor(placement.actor);
    applyFrame(placement.window, placement.target);
}
