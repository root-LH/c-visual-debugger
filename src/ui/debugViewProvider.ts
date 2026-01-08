import * as vscode from 'vscode';
import { frameKeyToString } from '../debug/debugState';
import { DebugState, VariableState } from '../debug/types';

type SerializableFrameState = {
	id: number;
	frameId: number;
	depth: number;
	name: string;
	file?: string;
	line: number;
	keyStr: string;
};

type SerializableDebugState = {
	stopReason?: string;
	stackFrames: SerializableFrameState[];
	frameVariables: Record<string, Record<string, VariableState>>;
};

function serializeDebugState(state: DebugState): SerializableDebugState {
	const frameVariables: Record<string, Record<string, VariableState>> = {};

	for (const [keyStr, vars] of state.frameVariables.entries()) {
		const record: Record<string, VariableState> = {};
		for (const [varName, varState] of vars.entries()) {
			record[varName] = varState;
		}
		frameVariables[keyStr] = record;
	}

	return {
		stopReason: state.stopReason,
		stackFrames: state.stackFrames.map((f) => ({
			id: f.id,
			frameId: f.key.frameId,
			depth: f.key.depth,
			name: f.key.name,
			file: f.file,
			line: f.line,
			keyStr: frameKeyToString(f.key),
		})),
		frameVariables,
	};
}

export class DebugViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'c-visual-debugger.view';

	private view?: vscode.WebviewView;
	private isReady = false;
	private lastState?: SerializableDebugState;

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		this.isReady = false;

		view.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri],
		};

		view.webview.html = this.getHtml(view.webview);

		view.onDidDispose(() => {
			if (this.view === view) {
				this.view = undefined;
				this.isReady = false;
			}
		});

		view.webview.onDidReceiveMessage((msg: unknown) => {
			if (!msg || typeof msg !== 'object') {
				return;
			}
			const message = msg as { type?: unknown };

			if (message.type === 'ready') {
				this.isReady = true;
				this.postState();
			}
		});
	}

	setState(state: DebugState): void {
		this.lastState = serializeDebugState(state);
		this.postState();
	}

	private postState(): void {
		if (!this.view || !this.isReady) {
			return;
		}

		this.view.webview.postMessage({
			type: 'state',
			state: this.lastState ?? {
				stopReason: undefined,
				stackFrames: [],
				frameVariables: {},
			},
		});
	}

	private getHtml(webview: vscode.Webview): string {
		const nonce = getNonce();

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>C Visual Debugger</title>
	<style>
		:root {
			--gap: 8px;
		}

		body {
			padding: 0;
			margin: 0;
			color: var(--vscode-foreground);
			background: var(--vscode-sideBar-background);
			font: var(--vscode-font-weight) var(--vscode-font-size) / 1.4 var(--vscode-font-family);
		}

		#app {
			display: grid;
			grid-template-rows: auto auto 1fr;
			height: 100vh;
		}

		header {
			padding: 10px 12px;
			border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
		}

		.title {
			font-weight: 600;
		}

		.status {
			margin-top: 4px;
			color: var(--vscode-descriptionForeground);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.nav {
			display: flex;
			align-items: center;
			gap: var(--gap);
			padding: 8px 12px;
			border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
		}

		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: 0;
			border-radius: 4px;
			padding: 4px 10px;
			cursor: pointer;
		}

		button:disabled {
			opacity: 0.55;
			cursor: default;
		}

		select {
			flex: 1;
			min-width: 120px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
			border-radius: 4px;
			padding: 4px 8px;
		}

		.main {
			padding: 10px 12px;
			overflow: auto;
		}

		table {
			width: 100%;
			border-collapse: collapse;
			font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
		}

		th, td {
			text-align: left;
			padding: 6px 8px;
			border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255, 255, 255, 0.08));
			vertical-align: top;
		}

		th {
			position: sticky;
			top: 0;
			background: var(--vscode-sideBar-background);
			z-index: 1;
		}

		tr.changed td {
			background: var(--vscode-editor-findMatchBackground, rgba(255, 215, 0, 0.12));
		}

		.empty {
			margin-top: 10px;
			color: var(--vscode-descriptionForeground);
		}

		.value {
			white-space: pre-wrap;
			word-break: break-word;
		}
	</style>
</head>
<body>
	<div id="app">
		<header>
			<div class="title">C Visual Debugger</div>
			<div id="status" class="status">Waiting for debug stop…</div>
		</header>

		<div class="nav">
			<button id="prevBtn" type="button" aria-label="Previous frame">Prev</button>
			<button id="nextBtn" type="button" aria-label="Next frame">Next</button>
			<select id="frameSelect" aria-label="Stack frames"></select>
		</div>

		<main class="main">
			<table aria-label="Local variables">
				<thead>
					<tr>
						<th style="width: 40%">Name</th>
						<th>Value</th>
					</tr>
				</thead>
				<tbody id="varsBody"></tbody>
			</table>
			<div id="emptyVars" class="empty" style="display: none">No variables.</div>
		</main>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		/** @type {{ stopReason?: string, stackFrames: Array<{ id:number, frameId:number, depth:number, name:string, file?:string, line:number, keyStr:string }>, frameVariables: Record<string, Record<string, { name:string, prev?:string, curr:string, changed:boolean }>> } | null} */
		let state = null;
		let selectedFrameIndex = 0;

		const statusEl = document.getElementById('status');
		const prevBtn = document.getElementById('prevBtn');
		const nextBtn = document.getElementById('nextBtn');
		const frameSelect = document.getElementById('frameSelect');
		const varsBody = document.getElementById('varsBody');
		const emptyVars = document.getElementById('emptyVars');

		function basename(p) {
			if (!p) return 'unknown';
			const parts = p.split(/[/\\\\]/);
			return parts[parts.length - 1] || 'unknown';
		}

		function formatFrameOption(index, frame) {
			const fileLabel = basename(frame.file);
			return \`#\${index}  \${frame.name}  (\${fileLabel}:\${frame.line})\`;
		}

		function clampIndex(index, length) {
			if (length <= 0) return 0;
			return Math.max(0, Math.min(index, length - 1));
		}

		function render() {
			const frames = state?.stackFrames ?? [];
			const hasFrames = frames.length > 0;

			selectedFrameIndex = clampIndex(selectedFrameIndex, frames.length);

			prevBtn.disabled = !hasFrames || selectedFrameIndex <= 0;
			nextBtn.disabled = !hasFrames || selectedFrameIndex >= frames.length - 1;

			while (frameSelect.firstChild) frameSelect.removeChild(frameSelect.firstChild);

			for (let i = 0; i < frames.length; i++) {
				const opt = document.createElement('option');
				opt.value = String(i);
				opt.textContent = formatFrameOption(i, frames[i]);
				frameSelect.appendChild(opt);
			}
			frameSelect.value = String(selectedFrameIndex);

			while (varsBody.firstChild) varsBody.removeChild(varsBody.firstChild);

			if (!hasFrames) {
				statusEl.textContent = 'Waiting for debug stop…';
				emptyVars.style.display = 'none';
				return;
			}

			const frame = frames[selectedFrameIndex];
			const reason = state?.stopReason ? \`Stopped: \${state.stopReason}\` : 'Stopped';
			statusEl.textContent = \`\${reason} — \${formatFrameOption(selectedFrameIndex, frame)}\`;

			const frameVars = (state?.frameVariables ?? {})[frame.keyStr] ?? {};
			const names = Object.keys(frameVars).sort((a, b) => a.localeCompare(b));

			for (const name of names) {
				const v = frameVars[name];

				const tr = document.createElement('tr');
				if (v.changed) tr.classList.add('changed');

				const nameTd = document.createElement('td');
				nameTd.textContent = v.name;

				const valueTd = document.createElement('td');
				valueTd.className = 'value';
				if (v.prev !== undefined && v.changed) {
					valueTd.textContent = \`\${v.prev} → \${v.curr}\`;
				} else {
					valueTd.textContent = v.curr;
				}

				tr.appendChild(nameTd);
				tr.appendChild(valueTd);
				varsBody.appendChild(tr);
			}

			emptyVars.style.display = names.length === 0 ? 'block' : 'none';
		}

		prevBtn.addEventListener('click', () => {
			selectedFrameIndex = Math.max(0, selectedFrameIndex - 1);
			render();
		});

		nextBtn.addEventListener('click', () => {
			const len = state?.stackFrames?.length ?? 0;
			selectedFrameIndex = Math.min(len - 1, selectedFrameIndex + 1);
			render();
		});

		frameSelect.addEventListener('change', () => {
			const idx = Number(frameSelect.value);
			if (Number.isFinite(idx)) {
				selectedFrameIndex = idx;
				render();
			}
		});

		window.addEventListener('message', (event) => {
			const msg = event.data;
			if (!msg || typeof msg !== 'object') return;
			if (msg.type !== 'state') return;

			state = msg.state ?? null;
			render();
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
