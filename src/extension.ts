import * as vscode from 'vscode';
import { WebSocketServer, WebSocket as WSWebSocket } from 'ws';

const port = 42121;

let logger: vscode.LogOutputChannel;
let wss: WebSocketServer;

enum MessageType {
  MessageOutput = 0,
  MessageInformation = 1,
  MessageWarning = 2,
  MessageError = 3
}

type ExtendedWebSocket = WSWebSocket & {
  clientData?: { displayName: string; name: string };
};

export function activate(context: vscode.ExtensionContext) {
  logger = vscode.window.createOutputChannel("ROBLOX Connect", { log: true });
  logger.show();

  context.subscriptions.push(vscode.commands.registerCommand('robloxconnect.execute_active', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      runLuasOnConnectedClients([editor.document.getText()]);
    } else {
      vscode.window.showErrorMessage(`You don't have a file open or active.`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('robloxconnect.execute_input', async () => {
    const input = await vscode.window.showInputBox({
      title: 'ROBLOX Connect',
      placeHolder: 'Enter Lua code to execute',
      ignoreFocusOut: true
    });
    if (input !== undefined) runLuasOnConnectedClients([input]);
  }));

  const executeButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  executeButton.command = 'robloxconnect.execute_active';
  executeButton.text = '$(debug-start) Execute Lua';
  executeButton.tooltip = 'Execute the Lua code in the current editor on ROBLOX';
  executeButton.show();

  logger.info('ROBLOX Connect extension activated');

  wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    const ws = socket as ExtendedWebSocket;
    logger.debug('WebSocket connection established');

    ws.on('message', (data) => {
      const json = JSON.parse(data.toString());

      if (json.type === 'connect') {
        ws.clientData = json.data;
        vscode.window.showInformationMessage(`Connected: ${json.data.displayName} (${json.data.name})`);
        logger.info(`Connected: ${json.data.displayName} (${json.data.name})`);
      } else if (json.type === 'log') {
        const prefix = wss.clients.size > 1 && ws.clientData ? `[${ws.clientData.name}] ` : '';
        const message = `${prefix}[ROBLOX] ${json.data.message}`;

        switch (json.data.type) {
          case MessageType.MessageOutput: logger.info(message); break;
          case MessageType.MessageInformation: logger.debug(message); break;
          case MessageType.MessageWarning: logger.warn(message); break;
          case MessageType.MessageError: logger.error(message); break;
        }
      } else if (json.type === 'detailed_error') {
        const prefix = wss.clients.size > 1 && ws.clientData ? `[${ws.clientData.name}] ` : '';
        logger.error(`${prefix}[ROBLOX] ${json.data.message}`);
      } else if (json.type === 'external_execute') {
        runLuasOnConnectedClients([json.data.code]);
        vscode.window.showInformationMessage('Executed from external UI');
      }
    });

    ws.on('close', () => {
      if (ws.clientData) {
        vscode.window.showWarningMessage(`Disconnected: ${ws.clientData.displayName} (${ws.clientData.name})`);
        logger.info(`Disconnected: ${ws.clientData.displayName} (${ws.clientData.name})`);
      }
    });
  });

  wss.on('listening', () => logger.debug(`WebSocket Server listening on port ${port}`));
}

export function deactivate() {
  logger.info('ROBLOX Connect extension deactivated');
  if (wss) {
    for (const client of wss.clients) (client as ExtendedWebSocket).close();
    wss.close();
  }
}

async function runLuasOnConnectedClients(luas: string[]) {
  if (!wss || wss.clients.size === 0) {
    vscode.window.showErrorMessage(`You don't have any ROBLOX client connected.`);
    return;
  }

  for (const client of wss.clients) {
    const ws = client as ExtendedWebSocket;
    ws.send(JSON.stringify({ type: 'run_luas', data: { luas } }));
    vscode.window.showInformationMessage(`Executed Lua on ${ws.clientData?.displayName ?? 'client'}`);
  }
}
