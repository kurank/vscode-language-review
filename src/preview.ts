"use strict";

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const WEBROOT = "webroot"; // review-webmaker のデフォルト出力先

function getConfigPath(docDir: string): string | null {
  const inDocDir = path.join(docDir, "config.yml");
  if (fs.existsSync(inDocDir)) return inDocDir;
  const inSrc = path.join(docDir, "..", "config.yml");
  if (fs.existsSync(inSrc)) return path.resolve(inSrc);
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    const inRoot = path.join(folders[0].uri.fsPath, "src", "config.yml");
    if (fs.existsSync(inRoot)) return inRoot;
  }
  return null;
}

function getHtmlext(docDir: string): string {
  const configPath = getConfigPath(docDir);
  if (!configPath) return "xhtml";
  try {
    const yaml = fs.readFileSync(configPath, "utf8");
    const m = yaml.match(/^\s*htmlext:\s*(\S+)/m);
    return m ? m[1].trim() : "xhtml";
  } catch {
    return "xhtml";
  }
}

async function buildOneWithWebmaker(
  docDir: string,
  reFileName: string,
  configPath: string,
): Promise<{ stdout: string; stderr: string }> {
  const only = path.basename(reFileName, ".re");
  const configBasename = path.basename(configPath);
  const configDir = path.dirname(configPath);
  // review-webmaker は config のあるディレクトリで実行する
  return execFileAsync(
    "review-webmaker",
    ["-y", `${only}.re`, configBasename],
    { cwd: configDir, maxBuffer: 4 * 1024 * 1024 },
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "review.showPreview",
      async (uri?: vscode.Uri) => {
        const doc = uri
          ? vscode.workspace.textDocuments.find(
              (d) => d.uri.fsPath === uri.fsPath,
            )
          : vscode.window.activeTextEditor?.document;
        if (!doc || path.extname(doc.fileName) !== ".re") {
          vscode.window.showErrorMessage(
            "Re:VIEW の .re ファイルを開いてからプレビューを実行してください。",
          );
          return;
        }

        const docDir = path.dirname(doc.fileName);
        const reFileName = path.basename(doc.fileName);
        const configPath = getConfigPath(docDir);
        if (!configPath) {
          vscode.window.showErrorMessage(
            "config.yml が見つかりません。.re と同じディレクトリか src/ に配置してください。",
          );
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          "review-preview",
          `[preview] ${reFileName}`,
          vscode.ViewColumn.Two,
          {
            enableScripts: true,
            localResourceRoots: [
              vscode.Uri.file(path.join(path.dirname(configPath), WEBROOT)),
            ],
          },
        );

        panel.webview.html = "<html><body><p>ビルド中…</p></body></html>";

        try {
          await buildOneWithWebmaker(docDir, reFileName, configPath);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const stderr =
            err && typeof err === "object" && "stderr" in err
              ? String((err as { stderr: string }).stderr)
              : "";
          panel.webview.html = [
            "<html><body><h1>ビルドエラー</h1>",
            '<pre style="white-space:pre-wrap;">',
            escapeHtml(msg + (stderr ? "\n\n" + stderr : "")),
            "</pre></body></html>",
          ].join("");
          return;
        }

        const configDir = path.dirname(configPath);
        const webrootPath = path.join(configDir, WEBROOT);
        const baseName = path.basename(reFileName, ".re");
        const htmlext = getHtmlext(docDir);
        const htmlPath = path.join(webrootPath, `${baseName}.${htmlext}`);

        if (!fs.existsSync(htmlPath)) {
          panel.webview.html = [
            "<html><body><h1>プレビューエラー</h1>",
            "<p>生成ファイルが見つかりません: " + escapeHtml(htmlPath) + "</p>",
            "</body></html>",
          ].join("");
          return;
        }

        let html = fs.readFileSync(htmlPath, "utf8");
        const baseHref = panel.webview
          .asWebviewUri(vscode.Uri.file(webrootPath))
          .toString()
          .replace(/\/?$/, "/");
        if (!/<base\s/i.test(html)) {
          html = html.replace(/<head\s*>/i, `<head><base href="${baseHref}">`);
        }

        panel.webview.html = html;
      },
    ),
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
