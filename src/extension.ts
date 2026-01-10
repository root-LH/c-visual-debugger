import * as vscode from 'vscode';
import { DebugStateStore } from './debug/debugState';
import { FrameState } from './debug/types';
import { DebugViewProvider } from './ui/debugViewProvider';

let out: vscode.OutputChannel;

let debugState: DebugStateStore;

// add value for testing (requires modification)
let watchList: string[] = ["test"];

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

	const breakPointListener = vscode.debug.onDidChangeBreakpoints((e) => {
		const breakpoints = vscode.debug.breakpoints;

		out.appendLine(`BreakPoints: ${breakpoints.length} entry`);
		breakpoints.forEach(bp => {
			if (bp instanceof vscode.SourceBreakpoint){
				// transfer break point information to UI/UX (Not implemented)
				out.appendLine(`File: ${bp.location.uri.fsPath}, Line: ${bp.location.range.start.line + 1}`);
			}
		})
	})

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

						if (frames.length > 0) {
							const topFrameId = frames[0].id;
							
							out.appendLine(`[watches]`);
							for (const expr of watchList) {
								try {
									const evalResp = await session.customRequest('evaluate', {
										expression: expr,
										frameId: topFrameId,
										context: 'watch'
									});

									if (evalResp?.result) {
										const watchKey = { frameId: -1, depth: -1, name: 'WATCH' };
										const state = debugState.updateVariable(watchKey, expr, evalResp.result); //

										if (state.prev === undefined) {
											out.appendLine(`  ${expr}: ${state.curr}`);
										} else if (state.changed) {
											out.appendLine(`  ${expr}: ${state.prev} -> ${state.curr}`);
										} else {
											out.appendLine(`  ${expr}: ${state.curr} (unchanged)`);
										}
									}
								} catch (e) {
									
								}
							}
						}

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
