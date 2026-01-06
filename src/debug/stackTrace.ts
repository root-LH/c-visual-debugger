import * as vscode from "vscode";
import { DebugProtocol } from "@vscode/debugprotocol"
import { FrameState } from "./types";

export async function readCallStack(): Promise<FrameState[]> {
    const session = vscode.debug.activeDebugSession;
    if (!session) return [];

    const res = await session.customRequest("stackTrace", {
        threadId: 1,
        startFrame: 0,
        levels: 20
    });

    return (res.stackFrames ?? []).map((f: DebugProtocol.StackFrame) => ({
        id: f.id,
        name: f.name,
        file: f.source?.path,
        line: f.line
    }));
}