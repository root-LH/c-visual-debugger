import * as vscode from 'vscode';
import { DebugStateStore } from './debug/debugState';
import { FrameState } from './debug/types';
import { DebugViewProvider } from './ui/debugViewProvider';

let out: vscode.OutputChannel;

let debugState: DebugStateStore;

async function collectStackFrames(session: vscode.DebugSession): Promise<FrameState[]>{
	const resp = await session.customRequest('stackTrace', {
		threadId: 1,
	});

	const frames = resp.stackFrames ?? [];
	const totalFrames = frames.length;

	return frames.map((f: any, index: number) => ({
		id: f.id,
        file: f.source?.path,
		key: {
            frameId: f.id,
			depth: totalFrames - 1 - index,
			name: f.name,
        },
        line: f.line,
	}));
}

export function activate(context: vscode.ExtensionContext) {
	out = vscode.window.createOutputChannel('C Visual Debugger');
	out.show(true);

	debugState = new DebugStateStore();

	const debugViewProvider = new DebugViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			DebugViewProvider.viewType,
			debugViewProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	const trackerDisposable =
		vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
            createDebugAdapterTracker(session) {
                out.appendLine(`Tracker attached: ${session.name}`);

                return {
                    onDidSendMessage: async (msg: any) => {
                        if (msg?.type !== 'event') {
							return;
						}
                        if (msg.event !== 'stopped') {
							return;
						}

                        const reason = msg.body?.reason ?? 'unknown';

                        out.appendLine(`STOPPED: reason=${reason}`);
						debugState.setStopReason(reason);

                        const frames = await collectStackFrames(session);
                        debugState.setStackFrames(frames);

                        for (const frame of [...frames].reverse()) {
                            out.appendLine(
                                `[frame depth=${frame.key.depth} name=${frame.key.name}]`
                            );

                            const locals = await getLocals(session, frame.id);

                            for (const v of locals) {
                                const state = debugState.updateVariable(
                                    frame.key,
                                    v.name,
                                    v.value
                                );

                                if (state.prev === undefined) {
                                    out.appendLine(`  ${state.name} = ${state.curr}`);
                                } else if (state.changed) {
                                    out.appendLine(`  ${state.name}: ${state.prev} -> ${state.curr}`);
                                } else{
									out.appendLine(`  ${state.name} = ${state.curr} (unchanged)`);
								}
                            }
                        }

						debugViewProvider.setState(debugState.getState());
                    }
                };
            }
        });
	context.subscriptions.push(trackerDisposable);
}

export function deactivate() {}

async function getLocals(
	session: vscode.DebugSession,
	frameId: number
): Promise<Array<{ name: string; value: string }>> {
	const scopesResp = await session.customRequest('scopes', {frameId});

	const localsScope = (scopesResp?.scopes ?? []).find((s: any) =>
		typeof s?.name === 'string' && s.name.toLowerCase().includes('local')
	) ?? scopesResp?.scopes?.[0];

	const variablesReference = localsScope?.variablesReference;
	if (!variablesReference) {
		return [];
	}

	const varsResp = await session.customRequest('variables', {variablesReference});
	const vars = varsResp?.variables ?? [];

	return vars
		.filter((v: any) => typeof v?.name === 'string')
		.map((v: any) => ({name: String(v.name), value: String(v.value ?? '')}));
}
