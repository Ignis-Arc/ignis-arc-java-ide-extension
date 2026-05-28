import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let jdtlsReady = false;
let complexityCodeLensProvider: JavaComplexityCodeLensProvider | undefined;
let referencesCodeLensProvider: JavaReferencesCodeLensProvider | undefined;

import { getInstructionHover } from './jvmInstructions';
const bytecodeLineMappings = new Map<string, Record<number, number>>();

// ==========================================
// 1. Complexity Lenses Code
// ==========================================

interface MethodMetric {
    name: string;
    complexity: number;
    startLine: number; // 1-indexed
    endLine: number;   // 1-indexed
}

function registerComplexityLens(context: vscode.ExtensionContext) {
    // Command for interactive explanation
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.complexity.explain', (metric: MethodMetric) => {
            const config = vscode.workspace.getConfiguration('ignis.java.complexity');
            const highThreshold = config.get<number>('highThreshold', 10);
            const mediumThreshold = config.get<number>('mediumThreshold', 5);

            let rating = 'Low';
            let advice = 'This function is simple and easy to maintain. Great job!';
            if (metric.complexity >= highThreshold) {
                rating = 'High (Refactoring Recommended)';
                advice = 'This function has too many decision paths. Consider breaking it down into smaller helper methods to improve readability, debuggability, and testability.';
            } else if (metric.complexity >= mediumThreshold) {
                rating = 'Moderate';
                advice = 'This function is moderately complex. Keep an eye on it to ensure it does not grow further.';
            }

            vscode.window.showInformationMessage(
                `Method "${metric.name}" Cyclomatic Complexity: ${metric.complexity} [${rating}]\n\n${advice}`,
                { modal: true }
            );
        })
    );

    // Register Code Lens Providers
    const docSelector: vscode.DocumentSelector = { scheme: 'file', language: 'java' };
    const codeLensProvider = new JavaComplexityCodeLensProvider();
    const referencesLensProvider = new JavaReferencesCodeLensProvider();
    complexityCodeLensProvider = codeLensProvider;
    referencesCodeLensProvider = referencesLensProvider;
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(docSelector, codeLensProvider),
        vscode.languages.registerCodeLensProvider(docSelector, referencesLensProvider)
    );
}

class JavaComplexityCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ignis.java.complexity')) {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    public refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        const highThreshold = config.get<number>('highThreshold', 10);
        const mediumThreshold = config.get<number>('mediumThreshold', 5);

        try {
            const metrics = await vscode.commands.executeCommand<MethodMetric[]>(
                'java.execute.workspaceCommand',
                'ignis.java.complexity.calculate',
                document.uri.toString()
            );

            if (!metrics || metrics.length === 0) {
                return [];
            }

            const lenses: vscode.CodeLens[] = [];

            for (const metric of metrics) {
                const line = Math.max(0, metric.startLine - 1);
                const range = new vscode.Range(line, 0, line, 0);

                let rating = '🟢 Low';
                if (metric.complexity >= highThreshold) {
                    rating = '🔴 High';
                } else if (metric.complexity >= mediumThreshold) {
                    rating = '🟡 Moderate';
                }

                const title = `Complexity: ${metric.complexity} (${rating})`;

                lenses.push(
                    new vscode.CodeLens(range, {
                        title: title,
                        command: 'ignis.java.complexity.explain',
                        arguments: [metric]
                    })
                );
            }

            return lenses;
        } catch (error) {
            console.error('Error calculating Java complexity:', error);
            return [];
        }
    }
}

class JavaSymbolCodeLens extends vscode.CodeLens {
    constructor(
        public readonly uri: vscode.Uri,
        range: vscode.Range,
        public readonly symbolKind: vscode.SymbolKind
    ) {
        super(range);
    }
}
function uriEquals(u1: vscode.Uri, u2: vscode.Uri): boolean {
    if (u1.scheme !== u2.scheme) return false;
    if (u1.scheme === 'file') {
        return u1.fsPath.toLowerCase() === u2.fsPath.toLowerCase();
    }
    return u1.toString().toLowerCase() === u2.toString().toLowerCase();
}

const fileLinesCache = new Map<string, string[]>();

async function getFileLine(uri: vscode.Uri, line: number): Promise<string> {
    if (uri.scheme === 'file') {
        const fsPath = uri.fsPath;
        // Check open documents first
        const doc = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath.toLowerCase() === fsPath.toLowerCase());
        if (doc) {
            if (line < doc.lineCount) {
                return doc.lineAt(line).text;
            }
            return '';
        }
        
        // Otherwise, read from cache or file system
        try {
            let lines = fileLinesCache.get(fsPath);
            if (!lines) {
                const content = await fs.promises.readFile(fsPath, 'utf8');
                lines = content.split(/\r?\n/);
                fileLinesCache.set(fsPath, lines);
                // Clear cache after 5 seconds to prevent stale data
                setTimeout(() => fileLinesCache.delete(fsPath), 5000);
            }
            if (line < lines.length) {
                return lines[line];
            }
        } catch {
            // ignore
        }
    } else {
        // Non-file schemes: fallback to openTextDocument
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            if (line < doc.lineCount) {
                return doc.lineAt(line).text;
            }
        } catch {
            // ignore
        }
    }
    return '';
}

async function isImportLine(uri: vscode.Uri, line: number): Promise<boolean> {
    const text = (await getFileLine(uri, line)).trim();
    return text.startsWith('import ') || text.startsWith('package ') || text === 'import' || text === 'package';
}

function isDeclaration(loc: vscode.Location, symbols: vscode.DocumentSymbol[]): boolean {
    for (const sym of symbols) {
        if (
            sym.kind === vscode.SymbolKind.Class ||
            sym.kind === vscode.SymbolKind.Interface ||
            sym.kind === vscode.SymbolKind.Enum ||
            sym.kind === vscode.SymbolKind.Constructor ||
            sym.kind === vscode.SymbolKind.Method ||
            sym.kind === vscode.SymbolKind.Field ||
            sym.kind === vscode.SymbolKind.EnumMember ||
            sym.kind === vscode.SymbolKind.Constant
        ) {
            if (sym.selectionRange.intersection(loc.range) !== undefined) {
                return true;
            }
        }
        if (sym.children && sym.children.length > 0) {
            if (isDeclaration(loc, sym.children)) {
                return true;
            }
        }
    }
    return false;
}

class JavaReferencesCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ignis.java.references')) {
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    public refresh() {
        this._onDidChangeCodeLenses.fire();
    }

    async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.references');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        try {
            // Retrieve all hierarchical document symbols from the active document
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            const lenses: vscode.CodeLens[] = [];

            const traverse = (syms: vscode.DocumentSymbol[]) => {
                for (const sym of syms) {
                    if (
                        sym.kind === vscode.SymbolKind.Class ||
                        sym.kind === vscode.SymbolKind.Interface ||
                        sym.kind === vscode.SymbolKind.Enum ||
                        sym.kind === vscode.SymbolKind.EnumMember ||
                        sym.kind === vscode.SymbolKind.Method ||
                        sym.kind === vscode.SymbolKind.Constructor ||
                        sym.kind === vscode.SymbolKind.Field ||
                        sym.kind === vscode.SymbolKind.Constant
                    ) {
                        lenses.push(new JavaSymbolCodeLens(document.uri, sym.selectionRange, sym.kind));
                        
                        // Add "⚡ view bytecode" Lens for Class, Interface, Method, Constructor
                        if (
                            sym.kind === vscode.SymbolKind.Class ||
                            sym.kind === vscode.SymbolKind.Interface ||
                            sym.kind === vscode.SymbolKind.Method ||
                            sym.kind === vscode.SymbolKind.Constructor
                        ) {
                            lenses.push(new vscode.CodeLens(sym.selectionRange, {
                                title: '⚡ view bytecode',
                                command: 'ignis.java.bytecode.view',
                                arguments: [document.uri, sym.selectionRange.start.line + 1]
                            }));
                        }
                    }
                    if (sym.children && sym.children.length > 0) {
                        traverse(sym.children);
                    }
                }
            };

            traverse(symbols);
            return lenses;
        } catch (error) {
            console.error('Error providing references Code Lenses:', error);
            return [];
        }
    }

    async resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens> {
        if (!(codeLens instanceof JavaSymbolCodeLens)) {
            return codeLens;
        }

        const activeUri = codeLens.uri;
        const position = codeLens.range.start;
        const kind = codeLens.symbolKind;

        try {
            // Retrieve all hierarchical document symbols from the active file to filter out declarations
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                activeUri
            ).then(r => r || [], () => []);

            if (kind === vscode.SymbolKind.Interface) {
                // Query implementations
                const impls = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeImplementationProvider',
                    activeUri,
                    position
                );
                
                const filteredImpls: vscode.Location[] = [];
                if (impls) {
                    for (const loc of impls) {
                        if (uriEquals(loc.uri, activeUri)) {
                            if (isDeclaration(loc, symbols)) {
                                continue;
                            }
                        }
                        filteredImpls.push(loc);
                    }
                }

                const count = filteredImpls.length;
                const title = count > 0 
                    ? `🔗 ${count} implementation${count === 1 ? '' : 's'}`
                    : '🔗 no implementations';

                codeLens.command = {
                    title: title,
                    command: 'editor.action.showReferences',
                    arguments: [activeUri, position, filteredImpls]
                };
            } else if (kind === vscode.SymbolKind.Class) {
                // Query implementations (subclasses)
                const subclasses = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeImplementationProvider',
                    activeUri,
                    position
                );

                const filteredSubclasses: vscode.Location[] = [];
                if (subclasses) {
                    for (const loc of subclasses) {
                        if (uriEquals(loc.uri, activeUri)) {
                            if (isDeclaration(loc, symbols)) {
                                continue;
                            }
                        }
                        filteredSubclasses.push(loc);
                    }
                }

                const subclassCount = filteredSubclasses.length;

                if (subclassCount > 0) {
                    const title = `🔗 ${subclassCount} subclass${subclassCount === 1 ? '' : 'es'}`;
                    codeLens.command = {
                        title: title,
                        command: 'editor.action.showReferences',
                        arguments: [activeUri, position, filteredSubclasses]
                    };
                } else {
                    // Fallback to general references/usages
                    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeReferenceProvider',
                        activeUri,
                        position
                    );

                    const filteredLocations: vscode.Location[] = [];
                    if (locations) {
                        for (const loc of locations) {
                            if (uriEquals(loc.uri, activeUri)) {
                                if (isDeclaration(loc, symbols)) {
                                    continue;
                                }
                            }
                            const isImport = await isImportLine(loc.uri, loc.range.start.line);
                            if (isImport) {
                                continue;
                            }
                            filteredLocations.push(loc);
                        }
                    }

                    const count = filteredLocations.length;
                    const title = count > 0 
                        ? `🔗 ${count} usage${count === 1 ? '' : 's'}`
                        : '🔗 no usages';

                    codeLens.command = {
                        title: title,
                        command: 'editor.action.showReferences',
                        arguments: [activeUri, position, filteredLocations]
                    };
                }
            } else {
                // Default to general references/usages (for fields, methods, enums, enum members, etc.)
                const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    activeUri,
                    position
                );

                const filteredLocations: vscode.Location[] = [];
                if (locations) {
                    for (const loc of locations) {
                        if (uriEquals(loc.uri, activeUri)) {
                            if (isDeclaration(loc, symbols)) {
                                continue;
                            }
                        }
                        const isImport = await isImportLine(loc.uri, loc.range.start.line);
                        if (isImport) {
                            continue;
                        }
                        filteredLocations.push(loc);
                    }
                }

                const count = filteredLocations.length;
                const title = count > 0 
                    ? `🔗 ${count} usage${count === 1 ? '' : 's'}`
                    : '🔗 no usages';

                codeLens.command = {
                    title: title,
                    command: 'editor.action.showReferences',
                    arguments: [activeUri, position, filteredLocations]
                };
            }
        } catch (error) {
            codeLens.command = {
                title: '🔗 no usages',
                command: ''
            };
        }

        return codeLens;
    }
}

// ==========================================
// 2. Project Navigator Code
// ==========================================

const ignoredNames = new Set(['.git', '.DS_Store', '.settings', '.classpath', '.project']);

enum NodeType {
    ProjectRoot,
    LocalFolder,
    LocalFile,
    SystemLibraryContainer,
    ReferencedLibraryContainer,
    LibraryJar,
    Package,
    Class
}

class IgnisJavaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: NodeType,
        public readonly pathValue: string,
        public readonly extraData?: any
    ) {
        super(label, collapsibleState);
        this.contextValue = NodeType[type];

        switch (type) {
            case NodeType.ProjectRoot:
                this.resourceUri = vscode.Uri.file(pathValue);
                break;
            case NodeType.LocalFolder:
                this.resourceUri = vscode.Uri.file(pathValue);
                break;
            case NodeType.LocalFile:
                this.resourceUri = vscode.Uri.file(pathValue);
                this.command = {
                    command: 'vscode.open',
                    title: 'Open File',
                    arguments: [this.resourceUri]
                };
                break;
            case NodeType.SystemLibraryContainer:
                this.iconPath = new vscode.ThemeIcon('library');
                break;
            case NodeType.ReferencedLibraryContainer:
                this.iconPath = new vscode.ThemeIcon('library');
                break;
            case NodeType.LibraryJar:
                this.iconPath = new vscode.ThemeIcon('file-zip');
                break;
            case NodeType.Package:
                this.iconPath = vscode.ThemeIcon.Folder;
                break;
            case NodeType.Class:
                // Set resourceUri with a custom scheme to fetch active theme icons without triggering filesystem stat queries
                this.resourceUri = vscode.Uri.from({ scheme: 'jdt-class', path: '/' + label });
                this.command = {
                    command: 'ignis.java.navigator.openFile',
                    title: 'Open Class File',
                    arguments: [extraData] // The decompilable jdt:// URI
                };
                break;
        }
    }
}

class IgnisJavaProjectTreeDataProvider implements vscode.TreeDataProvider<IgnisJavaTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void> = new vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<IgnisJavaTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Cache to hold library structures returned by JDT LS
    private projectLibrariesCache = new Map<string, { jreName: string; systemLibraries: any[]; referencedLibraries: any[] }>();

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    clearCache(): void {
        this.projectLibrariesCache.clear();
    }

    getTreeItem(element: IgnisJavaTreeItem): vscode.TreeItem {
        return element;
    }

    private async getProjectLibrariesCached(projectPath: string) {
        if (this.projectLibrariesCache.has(projectPath)) {
            return this.projectLibrariesCache.get(projectPath);
        }
        try {
            const libs = await vscode.commands.executeCommand<any>(
                'java.execute.workspaceCommand',
                'ignis.java.project.getLibraries',
                projectPath
            );
            if (libs) {
                // Avoid caching empty lists while JDT LS is still loading/importing
                if ((!libs.systemLibraries || libs.systemLibraries.length === 0) &&
                    (!libs.referencedLibraries || libs.referencedLibraries.length === 0)) {
                    return null;
                }

                // Refine the JRE label based on path if it is generic
                if (libs.jreName === 'JDK System Library' && libs.systemLibraries && libs.systemLibraries.length > 0) {
                    const firstSystem = libs.systemLibraries.find((lib: any) => lib.path);
                    if (firstSystem) {
                        const pVal = firstSystem.path;
                        const lowerPath = pVal.toLowerCase();
                        let extractedName = '';
                        if (lowerPath.includes('/jvm/')) {
                            const parts = pVal.split(path.sep);
                            const jvmIdx = parts.findIndex((part: string) => part.toLowerCase() === 'jvm');
                            if (jvmIdx !== -1 && jvmIdx + 1 < parts.length) {
                                extractedName = parts[jvmIdx + 1];
                            }
                        } else if (lowerPath.includes('.sdkman/candidates/java/')) {
                            const parts = pVal.split(path.sep);
                            const javaIdx = parts.findIndex((part: string, idx: number) => part.toLowerCase() === 'java' && parts[idx - 1]?.toLowerCase() === 'candidates');
                            if (javaIdx !== -1 && javaIdx + 1 < parts.length) {
                                extractedName = parts[javaIdx + 1];
                            }
                        } else if (lowerPath.includes('javavirtualmachines')) {
                            const parts = pVal.split(path.sep);
                            const jvmIdx = parts.findIndex((part: string) => part.toLowerCase().includes('javavirtualmachines'));
                            if (jvmIdx !== -1 && jvmIdx + 1 < parts.length) {
                                extractedName = parts[jvmIdx + 1];
                            }
                        } else {
                            const dirName = path.basename(path.dirname(path.dirname(pVal)));
                            if (dirName && dirName !== '.' && dirName !== '..' && dirName.length > 2) {
                                extractedName = dirName;
                            }
                        }
                        if (extractedName) {
                            libs.jreName = `JDK System Library [${extractedName}]`;
                        }
                    }
                }

                this.projectLibrariesCache.set(projectPath, libs);
                return libs;
            }
        } catch (e) {
            console.error('Failed to fetch project libraries for:', projectPath, e);
        }
        return null;
    }

    async getChildren(element?: IgnisJavaTreeItem): Promise<IgnisJavaTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        // Root Level
        if (!element) {
            if (workspaceFolders.length === 1) {
                // Single root workspace: list all files/folders directly in root
                return this.getDirectoryAndLibraryNodes(workspaceFolders[0].uri.fsPath);
            } else {
                // Multi-root workspace: list project root folders
                return workspaceFolders.map(folder => new IgnisJavaTreeItem(
                    folder.name,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    NodeType.ProjectRoot,
                    folder.uri.fsPath
                ));
            }
        }

        // Project Root level (for multi-root workspace)
        if (element.type === NodeType.ProjectRoot) {
            return this.getDirectoryAndLibraryNodes(element.pathValue);
        }

        // Local Folders
        if (element.type === NodeType.LocalFolder) {
            const children: IgnisJavaTreeItem[] = [];
            try {
                const dirEntries = await fs.promises.readdir(element.pathValue, { withFileTypes: true });
                const filtered = dirEntries.filter(e => !ignoredNames.has(e.name));
                filtered.sort((a, b) => {
                    if (a.isDirectory() && !b.isDirectory()) { return -1; }
                    if (!a.isDirectory() && b.isDirectory()) { return 1; }
                    return a.name.localeCompare(b.name);
                });

                for (const entry of filtered) {
                    const fullPath = path.join(element.pathValue, entry.name);
                    children.push(new IgnisJavaTreeItem(
                        entry.name,
                        entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                        entry.isDirectory() ? NodeType.LocalFolder : NodeType.LocalFile,
                        fullPath
                    ));
                }
            } catch (e) {
                console.error('Failed to read folder contents:', element.pathValue, e);
            }
            return children;
        }

        // System Libraries container
        if (element.type === NodeType.SystemLibraryContainer) {
            const systemLibs = element.extraData as any[];
            if (!systemLibs) { return []; }
            return systemLibs.map(lib => new IgnisJavaTreeItem(
                lib.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                NodeType.LibraryJar,
                lib.path,
                lib.id
            ));
        }

        // Referenced Libraries container
        if (element.type === NodeType.ReferencedLibraryContainer) {
            const referencedLibs = element.extraData as any[];
            if (!referencedLibs) { return []; }
            return referencedLibs.map(lib => new IgnisJavaTreeItem(
                lib.name,
                vscode.TreeItemCollapsibleState.Collapsed,
                NodeType.LibraryJar,
                lib.path,
                lib.id
            ));
        }

        // Library JAR (contains packages)
        if (element.type === NodeType.LibraryJar) {
            const jarHandleId = element.extraData as string;
            try {
                const packages = await vscode.commands.executeCommand<any[]>(
                    'java.execute.workspaceCommand',
                    'ignis.java.library.getPackages',
                    jarHandleId
                );
                if (packages && packages.length > 0) {
                    // Sort packages alphabetically
                    packages.sort((a, b) => a.name.localeCompare(b.name));
                    return packages.map(pkg => new IgnisJavaTreeItem(
                        pkg.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.Package,
                        '',
                        pkg.id
                    ));
                }
            } catch (e) {
                console.error('Failed to get library packages:', jarHandleId, e);
            }
            return [];
        }

        // Package (contains classes)
        if (element.type === NodeType.Package) {
            const pkgHandleId = element.extraData as string;
            try {
                const classes = await vscode.commands.executeCommand<any[]>(
                    'java.execute.workspaceCommand',
                    'ignis.java.library.getClasses',
                    pkgHandleId
                );
                if (classes && classes.length > 0) {
                    // Sort classes alphabetically
                    classes.sort((a, b) => a.name.localeCompare(b.name));
                    return classes.map(cls => new IgnisJavaTreeItem(
                        cls.name,
                        vscode.TreeItemCollapsibleState.None,
                        NodeType.Class,
                        '',
                        cls.uri
                    ));
                }
            } catch (e) {
                console.error('Failed to get package classes:', pkgHandleId, e);
            }
            return [];
        }

        return [];
    }

    private async getDirectoryAndLibraryNodes(dirPath: string): Promise<IgnisJavaTreeItem[]> {
        const children: IgnisJavaTreeItem[] = [];

        // 1. Read files and directories on disk
        try {
            const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            const filtered = dirEntries.filter(e => !ignoredNames.has(e.name));
            filtered.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) { return -1; }
                if (!a.isDirectory() && b.isDirectory()) { return 1; }
                return a.name.localeCompare(b.name);
            });

            for (const entry of filtered) {
                const fullPath = path.join(dirPath, entry.name);
                children.push(new IgnisJavaTreeItem(
                    entry.name,
                    entry.isDirectory() ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    entry.isDirectory() ? NodeType.LocalFolder : NodeType.LocalFile,
                    fullPath
                ));
            }
        } catch (e) {
            console.error('Failed to read directory:', dirPath, e);
        }

        // 2. Fetch and append Java Libraries if JDT LS is initialized
        if (jdtlsReady) {
            const libs = await this.getProjectLibrariesCached(dirPath);
            if (libs) {
                if (libs.systemLibraries && libs.systemLibraries.length > 0) {
                    const jreLabel = libs.jreName || 'JDK System Library';
                    children.push(new IgnisJavaTreeItem(
                        jreLabel,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.SystemLibraryContainer,
                        dirPath,
                        libs.systemLibraries
                    ));
                }
                if (libs.referencedLibraries && libs.referencedLibraries.length > 0) {
                    children.push(new IgnisJavaTreeItem(
                        'Referenced Libraries',
                        vscode.TreeItemCollapsibleState.Collapsed,
                        NodeType.ReferencedLibraryContainer,
                        dirPath,
                        libs.referencedLibraries
                    ));
                }
            }
        }

        return children;
    }
}

// ==========================================
// 3. Complexity Explorer Sideview
// ==========================================

interface ComplexityItem {
    name: string;
    complexity: number;
    startLine: number; // 1-indexed
    endLine: number;   // 1-indexed
    uri: string;
    className: string;
}

class IgnisJavaComplexityTreeDataProvider implements vscode.TreeDataProvider<ComplexityItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ComplexityItem | undefined | null | void> = new vscode.EventEmitter<ComplexityItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<ComplexityItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private items: ComplexityItem[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ComplexityItem): vscode.TreeItem {
        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const criticalThreshold = config.get<number>('criticalThreshold', 20);
        const isCritical = element.complexity >= criticalThreshold;

        const treeItem = new vscode.TreeItem(
            `${element.className}.${element.name}`,
            vscode.TreeItemCollapsibleState.None
        );

        treeItem.description = `Complexity: ${element.complexity}`;
        
        if (isCritical) {
            treeItem.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problems.errorIcon.foreground'));
            treeItem.tooltip = `🔴 Critical Complexity: ${element.complexity}\nMethod: ${element.className}.${element.name}\nFile: ${vscode.Uri.parse(element.uri).fsPath}\nLine: ${element.startLine}`;
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problems.warningIcon.foreground'));
            treeItem.tooltip = `🟡 High Complexity: ${element.complexity}\nMethod: ${element.className}.${element.name}\nFile: ${vscode.Uri.parse(element.uri).fsPath}\nLine: ${element.startLine}`;
        }

        treeItem.command = {
            command: 'ignis.java.complexity.goto',
            title: 'Go to Method',
            arguments: [element]
        };

        return treeItem;
    }

    async getChildren(element?: ComplexityItem): Promise<ComplexityItem[]> {
        if (element) {
            return [];
        }

        if (!jdtlsReady) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ignis.java.complexity');
        const enabled = config.get<boolean>('enabled', true);
        if (!enabled) {
            return [];
        }

        const highThreshold = config.get<number>('highThreshold', 10);

        try {
            const results = await vscode.commands.executeCommand<ComplexityItem[]>(
                'java.execute.workspaceCommand',
                'ignis.java.complexity.scanWorkspace',
                highThreshold
            );

            this.items = results || [];
            return this.items;
        } catch (error) {
            console.error('Error scanning workspace complexity:', error);
            return [];
        }
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Ignis Arc Java IDE Extension Pack is active!');

    // Detect if this is a Java workspace to set custom context
    const hasJavaProject =
        (await vscode.workspace.findFiles('**/pom.xml', '**/node_modules/**', 1)).length > 0 ||
        (await vscode.workspace.findFiles('**/build.gradle', '**/node_modules/**', 1)).length > 0 ||
        (await vscode.workspace.findFiles('**/*.java', '**/node_modules/**', 1)).length > 0;

    vscode.commands.executeCommand('setContext', 'ignisJava:isJavaProject', hasJavaProject);

    // 1. Register TreeView & Code Lens Providers immediately
    const treeDataProvider = new IgnisJavaProjectTreeDataProvider();
    const treeView = vscode.window.createTreeView('ignisJavaProjectNavigator', {
        treeDataProvider,
        showCollapseAll: true
    });
    context.subscriptions.push(treeView);

    const complexityDataProvider = new IgnisJavaComplexityTreeDataProvider();
    const complexityView = vscode.window.createTreeView('ignisJavaComplexityAnalyzer', {
        treeDataProvider: complexityDataProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(complexityView);

    registerComplexityLens(context);

    // 2. Wait for Red Hat Java extension (JDT LS) to fully initialize
    const javaExtension = vscode.extensions.getExtension('redhat.java');
    if (javaExtension) {
        if (!javaExtension.isActive) {
            await javaExtension.activate();
        }

        const api = javaExtension.exports;
        if (api) {
            // Await the standard server ready promise
            if (typeof api.serverReady === 'function') {
                api.serverReady().then(() => {
                    console.log('Java Language Server is fully ready! Enabling Ignis Arc Explorer...');
                    jdtlsReady = true;
                    // Trigger refresh on both Code Lenses, Explorer, and Complexity tree views
                    treeDataProvider.clearCache();
                    treeDataProvider.refresh();
                    complexityDataProvider.refresh();
                    if (complexityCodeLensProvider) {
                        complexityCodeLensProvider.refresh();
                    }
                    if (referencesCodeLensProvider) {
                        referencesCodeLensProvider.refresh();
                    }
                });
            } else {
                jdtlsReady = true;
            }

            // Bind to JDT LS lifecycle events for dynamic auto-refreshing
            if (api.onDidProjectsImport) {
                context.subscriptions.push(
                    api.onDidProjectsImport(() => {
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    })
                );
            }
            if (api.onDidClasspathUpdate) {
                context.subscriptions.push(
                    api.onDidClasspathUpdate(() => {
                        treeDataProvider.clearCache();
                        treeDataProvider.refresh();
                        complexityDataProvider.refresh();
                    })
                );
            }
        } else {
            jdtlsReady = true;
        }
    } else {
        jdtlsReady = true;
    }

    // 3. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.navigator.refresh', () => {
            treeDataProvider.clearCache();
            treeDataProvider.refresh();
        }),
        vscode.commands.registerCommand('ignis.java.navigator.openFile', (uriStr: string) => {
            if (uriStr) {
                const uri = uriStr.startsWith('jdt:') ? vscode.Uri.parse(uriStr) : vscode.Uri.file(uriStr);
                vscode.workspace.openTextDocument(uri).then(
                    (doc) => {
                        vscode.window.showTextDocument(doc);
                    },
                    (err) => {
                        vscode.window.showErrorMessage(`Failed to open Java file: ${err}`);
                    }
                );
            }
        }),
        vscode.commands.registerCommand('ignis.java.complexity.refresh', () => {
            complexityDataProvider.refresh();
        }),
        vscode.commands.registerCommand('ignis.java.complexity.goto', (item: ComplexityItem) => {
            if (item && item.uri) {
                const uri = vscode.Uri.parse(item.uri);
                vscode.workspace.openTextDocument(uri).then(
                    (doc) => {
                        vscode.window.showTextDocument(doc).then((editor) => {
                            const line = Math.max(0, item.startLine - 1);
                            const pos = new vscode.Position(line, 0);
                            const endPos = new vscode.Position(line, doc.lineAt(line).text.length);
                            editor.selection = new vscode.Selection(pos, endPos);
                            editor.revealRange(new vscode.Range(pos, endPos), vscode.TextEditorRevealType.InCenter);
                        });
                    },
                    (err) => {
                        vscode.window.showErrorMessage(`Failed to open Java file: ${err}`);
                    }
                );
            }
        })
    );

    // 4. Hook up document save events to automatically refresh the complexity sideview on local saves with debounce
    let saveTimeout: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'java' || document.fileName.endsWith('.java')) {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }
                saveTimeout = setTimeout(() => {
                    complexityDataProvider.refresh();
                }, 500);
            }
        })
    );

    // 5. Register Bytecode Provider & Command
    const bytecodeProvider = new IgnisJavaBytecodeProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('ignis-bytecode', bytecodeProvider),
        vscode.commands.registerCommand('ignis.java.bytecode.view', async (uriOrItem?: any, line?: number) => {
            let uri: vscode.Uri | undefined;
            if (uriOrItem instanceof vscode.Uri) {
                uri = uriOrItem;
            } else if (vscode.window.activeTextEditor) {
                uri = vscode.window.activeTextEditor.document.uri;
                if (line === undefined && vscode.window.activeTextEditor.selection) {
                    line = vscode.window.activeTextEditor.selection.start.line + 1;
                }
            }

            if (!uri) {
                vscode.window.showErrorMessage('No active Java file to view bytecode.');
                return;
            }

            const virtualUri = vscode.Uri.from({
                scheme: 'ignis-bytecode',
                path: '/bytecode',
                query: `uri=${encodeURIComponent(uri.toString())}${line !== undefined ? `&line=${line}` : ''}`
            });

            try {
                const doc = await vscode.workspace.openTextDocument(virtualUri);
                await vscode.window.showTextDocument(doc, {
                    viewColumn: vscode.ViewColumn.Two,
                    preserveFocus: true
                });
                vscode.languages.setTextDocumentLanguage(doc, 'java');
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to open bytecode view: ${err.message || err}`);
            }
        })
    );

    // 6. Register JVM Instruction Hover Provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider({ scheme: 'ignis-bytecode' }, {
            provideHover(document, position, token) {
                const range = document.getWordRangeAtPosition(position);
                if (!range) {
                    return undefined;
                }
                const word = document.getText(range);
                return getInstructionHover(word);
            }
        })
    );

    // 7. Selection listener for Java sources to synchronize bytecode view
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((e) => {
            const editor = e.textEditor;
            if (editor.document.languageId !== 'java') {
                return;
            }

            const sourceUriStr = editor.document.uri.toString();
            // Find any open text editor showing our ignis-bytecode scheme targeting this source
            const bytecodeEditor = vscode.window.visibleTextEditors.find(ed => {
                if (ed.document.uri.scheme !== 'ignis-bytecode') {
                    return false;
                }
                const params = new URLSearchParams(ed.document.uri.query);
                return params.get('uri') === sourceUriStr;
            });

            if (!bytecodeEditor) {
                return;
            }

            const mappings = bytecodeLineMappings.get(bytecodeEditor.document.uri.toString());
            if (!mappings) {
                return;
            }

            const activeLine = editor.selection.active.line + 1; // 1-indexed
            const bytecodeLine = mappings[activeLine];
            if (bytecodeLine === undefined) {
                return;
            }

            const targetLine = Math.max(0, bytecodeLine - 1);
            const range = new vscode.Range(targetLine, 0, targetLine, 0);
            
            // Highlight target line in bytecode
            bytecodeEditor.selection = new vscode.Selection(targetLine, 0, targetLine, 100);
            
            // Scroll to target line in bytecode
            bytecodeEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        })
    );
}

class IgnisJavaBytecodeProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    public update(uri: vscode.Uri) {
        this._onDidChange.fire(uri);
    }

    async provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Promise<string> {
        try {
            const queryParams = new URLSearchParams(uri.query);
            const targetUriStr = queryParams.get('uri');
            const line = queryParams.get('line');

            if (!targetUriStr) {
                return '// Error: Missing target URI in virtual document query.';
            }

            const filterLombok = vscode.workspace.getConfiguration('ignis.java.bytecode').get<boolean>('filterLombok', true);
            const bytecode = await vscode.commands.executeCommand<any>(
                'java.execute.workspaceCommand',
                'ignis.java.bytecode.get',
                targetUriStr,
                line || null,
                filterLombok
            );

            if (bytecode === undefined) {
                return `// Debug Info:
// targetUriStr = ${targetUriStr}
// line = ${line}
// vscode.commands.executeCommand returned undefined.`;
            }
            if (bytecode === null) {
                return `// Debug Info:
// targetUriStr = ${targetUriStr}
// line = ${line}
// vscode.commands.executeCommand returned null.`;
            }
            if (typeof bytecode !== 'string') {
                return `// Debug Info:
// targetUriStr = ${targetUriStr}
// line = ${line}
// vscode.commands.executeCommand returned type: ${typeof bytecode}, value: ${JSON.stringify(bytecode)}`;
            }
            if (bytecode.trim() === '') {
                return `// Debug Info:
// targetUriStr = ${targetUriStr}
// line = ${line}
// vscode.commands.executeCommand returned an empty string.`;
            }

            // Parse line mappings from generated bytecode textifier comments
            const lineMappings: Record<number, number> = {};
            const lines = bytecode.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/\/\/ IgnisSrcLine:\s*(\d+)/);
                if (match) {
                    const sourceLine = parseInt(match[1]);
                    lineMappings[sourceLine] = i + 1; // 1-indexed
                }
            }
            bytecodeLineMappings.set(uri.toString(), lineMappings);

            return bytecode;
        } catch (e: any) {
            return `// Error retrieving bytecode:\n// ${e.message || e}`;
        }
    }
}

export function deactivate() {}

