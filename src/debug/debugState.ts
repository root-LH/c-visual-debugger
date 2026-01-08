import { DebugState, VariableState, FrameState, FrameKey } from "./types";

export function frameKeyToString(key: FrameKey): string{
    return `${key.depth}-${key.name}`;
}

export class DebugStateStore{
    private state: DebugState = {
        frameVariables: new Map(),
        stackFrames: []
    };

    updateVariable(frameKey: FrameKey, name: string, value: string): VariableState{
        const keyStr = frameKeyToString(frameKey);
        let frameVars = this.state.frameVariables.get(keyStr);

        if (!frameVars){
            frameVars = new Map();
            this.state.frameVariables.set(keyStr, frameVars);
        }
        const prevState = frameVars.get(name);

        const state: VariableState = {
            name,
            prev: prevState?.curr,
            curr: value,
            changed: prevState ? prevState.curr !== value : false,
        };

        frameVars.set(name, state);
        return state;
    }

    setStackFrames(frames: FrameState[]){
        this.state.stackFrames = frames;

        const currentKeys = new Set(frames.map(f => frameKeyToString(f.key)));
        
        for (const storedKey of this.state.frameVariables.keys()) {
            if (!currentKeys.has(storedKey)) {
                this.state.frameVariables.delete(storedKey);
            }
        }
    }

    setStopReason(reason?: string){
        this.state.stopReason = reason;
    }

    getState(): DebugState{
        return this.state;
    }

    clearVariables(){
        this.state.frameVariables.clear();
    }

    reset(stopReason?: string){
        this.state.stackFrames = [];
        this.state.stopReason = stopReason;
    }
}
