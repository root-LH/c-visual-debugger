import * as vscode from 'vscode';
import { DebugStateStore } from './debug/debugState';
import { FrameState } from './debug/types';

let out: vscode.OutputChannel;

let debugState: DebugStateStore;

export function activate(context: vscode.ExtensionContext) {
	out = vscode.window.createOutputChannel('C Visual Debugger');
	out.show(true);

	debugState = new DebugStateStore();

	const trackerDisposable =
		vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
			createDebugAdapterTracker(session) {
				out.appendLine(`Tracker attached: ${session.name}`);

				return {
					onDidSendMessage: async (msg: any) => {
						if (msg?.type !== 'event' || msg?.event !== 'stopped') return;

						const reason = msg.body?.reason ?? 'unknown';
						out.appendLine(`STOPPED: reason=${reason}`);
						debugState.setStopReason(reason);

						try {
							const locals = await getLocals(session);

							for (const v of locals) {
								const state = debugState.updateVariable(v.name, v.value);

								if (state.prev === undefined) {
									out.appendLine(`  ${state.name} = ${state.curr}`);
								} else if (state.changed) {
									out.appendLine(`  ${state.name}: ${state.prev} -> ${state.curr}`);
								}
							}

							const frames = await getStackFrames(session);
							debugState.setStackFrames(frames);

						} catch (e: any) {
							out.appendLine(`getLocals failed: ${e?.message ?? String(e)}`);
						}
					}
				};
			}
		});
	context.subscriptions.push(trackerDisposable);
}

export function deactivate() {}

async function getLocals(session: vscode.DebugSession): Promise<Array<{ name: string; value: string }>> {
	const threadsResp = await session.customRequest('threads');
	const threadId = threadsResp?.threads?.[0]?.id;
	if (!threadId) throw new Error('No threadId');

	const stackResp = await session.customRequest('stackTrace', {threadId});
	const frameId = stackResp?.stackFrames?.[0]?.id;
	if (!frameId) throw new Error('No frameId');

	const scopesResp = await session.customRequest('scopes', {frameId});

	const localsScope = (scopesResp?.scopes ?? []).find((s: any) =>
		typeof s?.name === 'string' && s.name.toLowerCase().includes('local')
	) ?? scopesResp?.scopes?.[0];
	
	const variablesReference = localsScope?.variablesReference;
	if (!variablesReference) return [];

	const varsResp = await session.customRequest('variables', {variablesReference});
	const vars = varsResp?.variables ?? [];

	return vars
		.filter((v: any) => typeof v?.name === 'string')
		.map((v: any) => ({name: String(v.name), value: String(v.value ?? '')}));
}

async function getStackFrames(session: vscode.DebugSession): Promise<FrameState[]>{
	const threads = await session.customRequest('threads');
	const threadId = threads.threads[0]?.id;

	if (!threadId) return [];

	const stack = await session.customRequest('stackTrace', {threadId});

	return stack.stackFrames.map((f: any) => ({
		id: f.id,
		name: f.name,
		file: f.source?.path,
		line: f.line
	}));
}