export interface VariableState{
    name: string;
    prev?: string;
    curr: string;
    changed: boolean;
}

export interface FrameState{
    id: number;
    name: string;
    file?: string;
    line: number;
}

export interface DebugState{
    variables: Map<string, VariableState>;
    stackFrames: FrameState[];
    stopReason?: string;
}