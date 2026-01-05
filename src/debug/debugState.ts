import { DebugState, VariableState, FrameState } from "./types";

export class DebugStateStore{
    private state: DebugState = {
        variables: new Map(),
        stackFrames: []
    };

    updateVariable(name: string, value: string): VariableState{
        const prev = this.state.variables.get(name)?.curr;
        const changed = prev !== undefined && prev !== value;

        const v: VariableState = {
            name,
            prev, 
            curr: value,
            changed
        };

        this.state.variables.set(name, v);
        return v;
    }

    setStackFrames(frames: FrameState[]){
        this.state.stackFrames = frames;
    }

    setStopReason(reason?: string){
        this.state.stopReason = reason;
    }

    getState(): DebugState{
        return this.state;
    }

    clearVariables(){
        this.state.variables.clear();
    }

    reset(){
        this.clearVariables();
        this.state.stackFrames = [];
        this.state.stopReason = undefined;
    }
}