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
    bytecodeSize?: number;
    maxStack?: number;
    maxLocals?: number;
    explicitAllocations?: number;
    potentialBoxing?: number;
    maxAllocationLoopDepth?: number;
    speedTier?: string;
    speedEmoji?: string;
    speedLabel?: string;
    inliningCategory?: string;
}

function registerComplexityLens(context: vscode.ExtensionContext) {
    // Command for interactive explanation (lightweight notification, non-modal)
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.complexity.explain', (metric: MethodMetric) => {
            const config = vscode.workspace.getConfiguration('ignis.java.complexity');
            const highThreshold = config.get<number>('highThreshold', 30);
            const criticalThreshold = config.get<number>('criticalThreshold', 60);

            let rating = '🟢 Low';
            let advice = 'Clean control flow with low cognitive and iteration load.';
            if (metric.complexity >= criticalThreshold) {
                rating = '🔴 Critical';
                advice = 'Deep nested iteration or excessive decision branches. Refactoring recommended.';
            } else if (metric.complexity >= highThreshold) {
                rating = '🟡 Moderate';
                advice = 'Contains nested loops or multiple branches. Review if logic can be simplified.';
            }

            let lines: string[] = [];
            lines.push(`Method: "${metric.name}"`);
            lines.push(`🧠 Cognitive / Structural: ${metric.complexity} [${rating}]`);
            lines.push(`💡 Advice: ${advice}`);

            if (metric.speedEmoji && metric.bytecodeSize !== undefined && metric.bytecodeSize > 0) {
                lines.push(`⚡ JIT Shape: ${metric.speedEmoji} ${(metric.speedTier || 'cruising').toUpperCase()} · ${metric.bytecodeSize}B (${metric.inliningCategory || 'Healthy JIT shape'})`);
                lines.push(`🥞 Frame: MaxStack=${metric.maxStack || 0}, MaxLocals=${metric.maxLocals || 0}`);
            }

            const allocs = metric.explicitAllocations || 0;
            const boxing = metric.potentialBoxing || 0;
            if (allocs > 0 || boxing > 0) {
                let riskItems: string[] = [];
                if (allocs > 0) {
                    riskItems.push(`${allocs} explicit allocation(s) in loop (depth ${metric.maxAllocationLoopDepth || 1})`);
                }
                if (boxing > 0) {
                    riskItems.push(`${boxing} potential boxing site(s)`);
                }
                lines.push(`⚠️ Runtime Signals: ${riskItems.join(' · ')}`);
            }

            vscode.window.showInformationMessage(lines.join('\n'));
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

interface CacheEntry {
    version: number;
    metrics: MethodMetric[];
    isBytecodeReady: boolean;
    timestamp: number;
}

const fastMetricsCache = new Map<string, CacheEntry>();
const pendingCalculations = new Set<string>();

class JavaComplexityCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

    constructor() {
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ignis.java.complexity') || e.affectsConfiguration('ignis.java.performance')) {
                this.clearCache();
                this._onDidChangeCodeLenses.fire();
            }
        });
    }

    public clearCache() {
        fastMetricsCache.clear();
        pendingCalculations.clear();
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

        const perfConfig = vscode.workspace.getConfiguration('ignis.java.performance');
        const fastCacheEnabled = perfConfig.get<boolean>('experimentalFastCache', true);

        const highThreshold = config.get<number>('highThreshold', 30);
        const criticalThreshold = config.get<number>('criticalThreshold', 60);
        const docKey = document.uri.toString();

        // 1. Fast-path: Check In-Memory Cache
        if (fastCacheEnabled) {
            const cached = fastMetricsCache.get(docKey);
            if (cached && cached.version === document.version) {
                return this.buildLensesFromMetrics(cached.metrics, highThreshold, criticalThreshold, cached.isBytecodeReady);
            }
        }

        // 2. Fetch fresh metrics from JDT LS backend
        try {
            if (pendingCalculations.has(docKey)) {
                const cached = fastMetricsCache.get(docKey);
                if (cached) {
                    return this.buildLensesFromMetrics(cached.metrics, highThreshold, criticalThreshold, false);
                }
            }

            pendingCalculations.add(docKey);
            const metrics = await vscode.commands.executeCommand<MethodMetric[]>(
                'java.execute.workspaceCommand',
                'ignis.java.complexity.calculate',
                docKey
            );
            pendingCalculations.delete(docKey);

            if (!metrics || metrics.length === 0) {
                fastMetricsCache.set(docKey, {
                    version: document.version,
                    metrics: [],
                    isBytecodeReady: true,
                    timestamp: Date.now()
                });
                return [];
            }

            const hasBytecode = metrics.some(m => m.bytecodeSize !== undefined && m.bytecodeSize > 0);

            fastMetricsCache.set(docKey, {
                version: document.version,
                metrics: metrics,
                isBytecodeReady: hasBytecode,
                timestamp: Date.now()
            });

            return this.buildLensesFromMetrics(metrics, highThreshold, criticalThreshold, hasBytecode);
        } catch (error) {
            pendingCalculations.delete(docKey);
            console.error('Error calculating Java complexity:', error);
            const cached = fastMetricsCache.get(docKey);
            if (cached) {
                return this.buildLensesFromMetrics(cached.metrics, highThreshold, criticalThreshold, cached.isBytecodeReady);
            }
            return [];
        }
    }

    private buildLensesFromMetrics(
        metrics: MethodMetric[],
        highThreshold: number,
        criticalThreshold: number,
        isBytecodeReady: boolean
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];

        for (const metric of metrics) {
            const line = Math.max(0, metric.startLine - 1);
            const range = new vscode.Range(line, 0, line, 0);

            let rating = '🟢 Low';
            if (metric.complexity >= criticalThreshold) {
                rating = '🔴 Critical';
            } else if (metric.complexity >= highThreshold) {
                rating = '🟡 Moderate';
            }

            let speedSuffix = '';
            if (metric.speedEmoji && metric.bytecodeSize !== undefined && metric.bytecodeSize > 0) {
                speedSuffix = ` | ${metric.speedLabel || `${metric.speedEmoji} ${metric.bytecodeSize}B`}`;
            } else if (!isBytecodeReady) {
                speedSuffix = ' | ⏳ Profiling...';
            }

            const title = `Complexity: ${metric.complexity} (${rating})${speedSuffix}`;

            lenses.push(
                new vscode.CodeLens(range, {
                    title: title,
                    command: 'ignis.java.complexity.explain',
                    arguments: [metric]
                })
            );
        }

        return lenses;
    }
}

class JavaSymbolCodeLens extends vscode.CodeLens {
    constructor(
        public readonly uri: vscode.Uri,
        range: vscode.Range,
        public readonly symbolKind: vscode.SymbolKind,
        public readonly parentKind?: vscode.SymbolKind
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
            if (
                sym.selectionRange.contains(loc.range.start) ||
                sym.selectionRange.contains(loc.range.end) ||
                loc.range.contains(sym.selectionRange.start) ||
                sym.selectionRange.intersection(loc.range) !== undefined
            ) {
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

function isLombokAnnotationLine(text: string): boolean {
    const trimmed = text.trim();
    const lombokAnns = [
        '@Data', '@Builder', '@NoArgsConstructor', '@AllArgsConstructor',
        '@RequiredArgsConstructor', '@Getter', '@Setter', '@Value',
        '@ToString', '@EqualsAndHashCode', '@Slf4j', '@Log'
    ];
    return lombokAnns.some(ann => trimmed.includes(ann));
}

function isSyntheticSymbol(sym: vscode.DocumentSymbol, document: vscode.TextDocument): boolean {
    const lineText = document.lineAt(sym.selectionRange.start.line).text;
    
    // If the line text contains any Lombok annotation, it is a generator line
    if (isLombokAnnotationLine(lineText)) {
        return true;
    }

    // Check if the symbol's name is actually present on its declaration line
    const name = sym.name;
    const cleanName = name.split('(')[0].trim();
    if (cleanName && !lineText.includes(cleanName)) {
        return true;
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

            const traverse = (syms: vscode.DocumentSymbol[], parentKind?: vscode.SymbolKind) => {
                for (const sym of syms) {
                    if (isSyntheticSymbol(sym, document)) {
                        if (sym.children && sym.children.length > 0) {
                            traverse(sym.children, sym.kind);
                        }
                        continue;
                    }
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
                        lenses.push(new JavaSymbolCodeLens(document.uri, sym.selectionRange, sym.kind, parentKind));
                        
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
                        traverse(sym.children, sym.kind);
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
                            const lineText = (await getFileLine(loc.uri, loc.range.start.line)).trim();
                            if (
                                lineText.includes('interface ') || 
                                isDeclaration(loc, symbols)
                            ) {
                                continue; // Filter out interface declaration itself
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
                            const lineText = (await getFileLine(loc.uri, loc.range.start.line)).trim();
                            if (
                                lineText.includes('@Builder') || 
                                lineText.includes('@Data') || 
                                lineText.includes('@Value') ||
                                lineText.includes('class ') || 
                                isDeclaration(loc, symbols)
                            ) {
                                continue; // Filter out Lombok builder and base class declaration itself
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

                // For methods, query implementation/overrides to filter them out of references
                let impls: vscode.Location[] = [];
                if (kind === vscode.SymbolKind.Method) {
                    impls = await vscode.commands.executeCommand<vscode.Location[]>(
                        'vscode.executeImplementationProvider',
                        activeUri,
                        position
                    ).then(r => r || [], () => []);
                }

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
                        
                        // Filter out overrides/implementations
                        if (kind === vscode.SymbolKind.Method && impls.length > 0) {
                            let isImpl = false;
                            for (const impl of impls) {
                                if (
                                    uriEquals(impl.uri, loc.uri) && 
                                    (impl.range.contains(loc.range.start) || 
                                     impl.range.contains(loc.range.end) || 
                                     loc.range.contains(impl.range.start) ||
                                     impl.range.intersection(loc.range) !== undefined)
                                ) {
                                    isImpl = true;
                                    break;
                                }
                            }
                            if (isImpl) {
                                continue; // Skip implementation overrides
                            }
                        }
                        
                        filteredLocations.push(loc);
                    }
                }

                let title = '';
                if (kind === vscode.SymbolKind.Method && impls.length > 0) {
                    const implsCount = impls.length;
                    const usagesCount = filteredLocations.length;
                    
                    const isInterface = codeLens.parentKind === vscode.SymbolKind.Interface;
                    const label = isInterface ? 'implementation' : 'override';
                    
                    const implText = `${implsCount} ${label}${implsCount === 1 ? '' : 's'}`;
                    const usageText = usagesCount > 0 ? `${usagesCount} usage${usagesCount === 1 ? '' : 's'}` : 'no usages';
                    title = `🔗 ${implText} · 🔗 ${usageText}`;
                } else {
                    const usagesCount = filteredLocations.length;
                    title = usagesCount > 0 
                        ? `🔗 ${usagesCount} usage${usagesCount === 1 ? '' : 's'}`
                        : '🔗 no usages';
                }

                const targetLocations = (kind === vscode.SymbolKind.Method && impls.length > 0)
                    ? [...impls, ...filteredLocations]
                    : filteredLocations;

                codeLens.command = {
                    title: title,
                    command: 'editor.action.showReferences',
                    arguments: [activeUri, position, targetLocations]
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

class IgnisJavaProjectTreeDataProvider implements vscode.TreeDataProvider<IgnisJavaTreeItem>, vscode.TreeDragAndDropController<IgnisJavaTreeItem> {
    dropMimeTypes = ['application/vnd.code.tree.ignisJavaProjectNavigator'];
    dragMimeTypes = ['application/vnd.code.tree.ignisJavaProjectNavigator'];

    private _onDidChangeTreeData: vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void> = new vscode.EventEmitter<IgnisJavaTreeItem | undefined | null | void>();
    public readonly onDidChangeTreeData: vscode.Event<IgnisJavaTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Cache to hold library structures returned by JDT LS
    private projectLibrariesCache = new Map<string, { jreName: string; systemLibraries: any[]; referencedLibraries: any[] }>();

    handleDrag(source: readonly IgnisJavaTreeItem[], treeDataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void | Thenable<void> {
        treeDataTransfer.set('application/vnd.code.tree.ignisJavaProjectNavigator', new vscode.DataTransferItem(source));
    }

    async handleDrop(target: IgnisJavaTreeItem | undefined, sources: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        const transferItem = sources.get('application/vnd.code.tree.ignisJavaProjectNavigator');
        if (!transferItem) {
            return;
        }
        const sourceItems: IgnisJavaTreeItem[] = transferItem.value;
        if (!sourceItems || sourceItems.length === 0) {
            return;
        }

        const targetDir = resolveTargetDirectory(target);
        if (!targetDir) {
            return;
        }

        for (const item of sourceItems) {
            const srcUri = resolveItemUri(item);
            if (!srcUri || srcUri.scheme !== 'file') {
                continue;
            }
            const fileName = path.basename(srcUri.fsPath);
            const destPath = path.join(targetDir, fileName);
            if (srcUri.fsPath === destPath) {
                continue;
            }
            const destUri = vscode.Uri.file(destPath);

            try {
                // Move file on disk
                await vscode.workspace.fs.rename(srcUri, destUri, { overwrite: false });

                // If it's a Java file, update package declaration automatically
                if (fileName.endsWith('.java')) {
                    await updateJavaPackageDeclaration(destUri, targetDir);
                }
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to move ${fileName}: ${err.message || err}`);
            }
        }

        this.refresh();
    }

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

interface NavigatorClipboard {
    sourceUri: vscode.Uri;
    isCut: boolean;
}

let navigatorClipboard: NavigatorClipboard | null = null;

function resolveTargetDirectory(item?: IgnisJavaTreeItem | vscode.Uri): string | undefined {
    if (item instanceof vscode.Uri) {
        try {
            const stat = fs.statSync(item.fsPath);
            return stat.isDirectory() ? item.fsPath : path.dirname(item.fsPath);
        } catch {
            return path.dirname(item.fsPath);
        }
    }
    if (item && item.pathValue) {
        if (item.type === NodeType.LocalFolder || item.type === NodeType.ProjectRoot) {
            return item.pathValue;
        }
        if (item.type === NodeType.LocalFile) {
            return path.dirname(item.pathValue);
        }
    }
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri.scheme === 'file') {
        return path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
    }
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    return undefined;
}

function resolveItemUri(item?: IgnisJavaTreeItem | vscode.Uri): vscode.Uri | undefined {
    if (item instanceof vscode.Uri) {
        return item;
    }
    if (item && item.resourceUri) {
        return item.resourceUri;
    }
    if (item && item.pathValue) {
        return vscode.Uri.file(item.pathValue);
    }
    if (vscode.window.activeTextEditor) {
        return vscode.window.activeTextEditor.document.uri;
    }
    return undefined;
}

function getJavaPackageFromPath(folderPath: string): string | undefined {
    const normalized = folderPath.replace(/\\/g, '/');
    const matches = [
        '/src/main/java/',
        '/src/test/java/',
        '/src/java/',
        '/src/'
    ];
    for (const m of matches) {
        const idx = normalized.lastIndexOf(m);
        if (idx !== -1) {
            const sub = normalized.substring(idx + m.length);
            if (sub) {
                return sub.replace(/\//g, '.');
            }
            return '';
        }
    }
    return undefined;
}

async function updateJavaPackageDeclaration(fileUri: vscode.Uri, targetDir: string): Promise<void> {
    try {
        const newPkg = getJavaPackageFromPath(targetDir);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const text = doc.getText();

        const pkgRegex = /^(\s*package\s+)([\w.]+)(\s*;)/m;
        const match = pkgRegex.exec(text);

        const edit = new vscode.WorkspaceEdit();

        if (newPkg) {
            if (match) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + match[0].length);
                edit.replace(fileUri, new vscode.Range(startPos, endPos), `package ${newPkg};`);
            } else {
                // Prepend package declaration
                edit.insert(fileUri, new vscode.Position(0, 0), `package ${newPkg};\n\n`);
            }
        } else {
            // Root package (default package)
            if (match) {
                const startPos = doc.positionAt(match.index);
                const endPos = doc.positionAt(match.index + match[0].length);
                edit.delete(fileUri, new vscode.Range(startPos, endPos));
            }
        }

        await vscode.workspace.applyEdit(edit);
        await doc.save();
    } catch (e) {
        console.error('Failed to update package declaration:', fileUri.fsPath, e);
    }
}

async function createJavaTypeFile(
    item: IgnisJavaTreeItem | vscode.Uri | undefined,
    typeKind: 'class' | 'interface' | 'enum' | 'record',
    treeDataProvider: IgnisJavaProjectTreeDataProvider
) {
    const targetDir = resolveTargetDirectory(item);
    if (!targetDir) {
        vscode.window.showErrorMessage('Unable to determine destination directory.');
        return;
    }

    const typeLabel = typeKind.charAt(0).toUpperCase() + typeKind.slice(1);
    const input = await vscode.window.showInputBox({
        prompt: `Enter Java ${typeLabel} name (e.g. OrderValidator or com.ignis.demo.OrderValidator)`,
        placeHolder: `My${typeLabel}`
    });

    if (!input || input.trim() === '') {
        return;
    }

    let rawInput = input.trim();
    if (rawInput.endsWith('.java')) {
        rawInput = rawInput.substring(0, rawInput.length - 5);
    }

    let finalDir = targetDir;
    let typeName = rawInput;
    let pkg = getJavaPackageFromPath(targetDir);

    if (rawInput.includes('.')) {
        const parts = rawInput.split('.');
        typeName = parts[parts.length - 1];
        const extraPkgParts = parts.slice(0, parts.length - 1);
        finalDir = path.join(targetDir, ...extraPkgParts);
        const addedPkg = extraPkgParts.join('.');
        pkg = pkg ? `${pkg}.${addedPkg}` : addedPkg;
    }

    const fileName = `${typeName}.java`;
    const filePath = path.join(finalDir, fileName);
    const fileUri = vscode.Uri.file(filePath);

    try {
        await vscode.workspace.fs.stat(fileUri);
        vscode.window.showWarningMessage(`File ${fileName} already exists.`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
        return;
    } catch {
        // File does not exist, proceed
    }

    // Generate template content
    let content = '';
    if (pkg) {
        content += `package ${pkg};\n\n`;
    }

    if (typeKind === 'record') {
        content += `public record ${typeName}() {\n    \n}\n`;
    } else {
        content += `public ${typeKind} ${typeName} {\n    \n}\n`;
    }

    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(finalDir));
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
        treeDataProvider.refresh();

        const doc = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(doc);

        const line = pkg ? 3 : 1;
        const pos = new vscode.Position(line, 4);
        editor.selection = new vscode.Selection(pos, pos);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to create Java ${typeLabel}: ${err.message || err}`);
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
    bytecodeSize?: number;
    maxStack?: number;
    maxLocals?: number;
    explicitAllocations?: number;
    potentialBoxing?: number;
    maxAllocationLoopDepth?: number;
    speedTier?: string;
    speedEmoji?: string;
    speedLabel?: string;
    inliningCategory?: string;
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
        const highThreshold = config.get<number>('highThreshold', 30);
        const criticalThreshold = config.get<number>('criticalThreshold', 60);

        let statusEmoji = '🟢';
        let ratingLabel = 'Low (Safe)';
        if (element.complexity >= criticalThreshold) {
            statusEmoji = '🔴';
            ratingLabel = 'Critical (Refactor Recommended)';
        } else if (element.complexity >= highThreshold) {
            statusEmoji = '🟡';
            ratingLabel = 'Moderate / Warning';
        }

        const treeItem = new vscode.TreeItem(
            `${statusEmoji} ${element.name}`,
            vscode.TreeItemCollapsibleState.None
        );

        const speedTag = (element.speedEmoji && element.bytecodeSize !== undefined && element.bytecodeSize > 0)
            ? ` | ${element.speedEmoji} ${element.bytecodeSize}B`
            : '';

        treeItem.description = `${element.className} • Score: ${element.complexity}${speedTag}`;
        
        const speedInfo = element.speedLabel ? `\n⚡ JIT Shape: ${element.speedLabel} (${element.inliningCategory || ''})` : '';
        const allocs = element.explicitAllocations || 0;
        const boxing = element.potentialBoxing || 0;
        let allocInfo = '';
        if (allocs > 0 || boxing > 0) {
            allocInfo = `\n⚠️ Runtime Signals: ${allocs} alloc(s) in loop, ${boxing} boxing site(s)`;
        }

        treeItem.tooltip = `${statusEmoji} Complexity: ${element.complexity} [${ratingLabel}]\nMethod: ${element.className}.${element.name}\nFile: ${vscode.Uri.parse(element.uri).fsPath}\nLine: ${element.startLine}${speedInfo}${allocInfo}`;

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

        const highThreshold = config.get<number>('highThreshold', 30);

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
        showCollapseAll: true,
        dragAndDropController: treeDataProvider
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
                        if (complexityCodeLensProvider) {
                            complexityCodeLensProvider.clearCache();
                            complexityCodeLensProvider.refresh();
                        }
                    })
                );
            }
        } else {
            jdtlsReady = true;
        }
    } else {
        jdtlsReady = true;
    }

    // Auto-refresh CodeLens on document save to sync compiled bytecode
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (doc.languageId === 'java' && complexityCodeLensProvider) {
                // Invalidate cache for this document so next lens request gets compiled bytecode
                const docKey = doc.uri.toString();
                fastMetricsCache.delete(docKey);
                // Slight delay to allow JDT LS ECJ background build to finish writing .class
                setTimeout(() => {
                    if (complexityCodeLensProvider) {
                        complexityCodeLensProvider.refresh();
                    }
                }, 300);
            }
        }),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            fastMetricsCache.delete(doc.uri.toString());
        })
    );

    // 3. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ignis.java.navigator.refresh', () => {
            treeDataProvider.clearCache();
            treeDataProvider.refresh();
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newFile', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const targetDir = resolveTargetDirectory(item);
            if (!targetDir) {
                vscode.window.showErrorMessage('Unable to determine destination directory.');
                return;
            }
            const fileName = await vscode.window.showInputBox({
                prompt: 'Enter new file name',
                placeHolder: 'file.txt'
            });
            if (!fileName || fileName.trim() === '') {
                return;
            }
            const fileUri = vscode.Uri.file(path.join(targetDir, fileName.trim()));
            try {
                await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
                treeDataProvider.refresh();
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create file: ${err.message || err}`);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newFolder', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const targetDir = resolveTargetDirectory(item);
            if (!targetDir) {
                vscode.window.showErrorMessage('Unable to determine destination directory.');
                return;
            }
            const folderName = await vscode.window.showInputBox({
                prompt: 'Enter new folder name',
                placeHolder: 'new-folder'
            });
            if (!folderName || folderName.trim() === '') {
                return;
            }
            const folderUri = vscode.Uri.file(path.join(targetDir, folderName.trim()));
            try {
                await vscode.workspace.fs.createDirectory(folderUri);
                treeDataProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to create folder: ${err.message || err}`);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newJavaClass', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            await createJavaTypeFile(item, 'class', treeDataProvider);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newJavaInterface', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            await createJavaTypeFile(item, 'interface', treeDataProvider);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newJavaEnum', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            await createJavaTypeFile(item, 'enum', treeDataProvider);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.newJavaRecord', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            await createJavaTypeFile(item, 'record', treeDataProvider);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.revealInOS', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.openInTerminal', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const targetDir = resolveTargetDirectory(item);
            if (targetDir) {
                const term = vscode.window.createTerminal({ cwd: targetDir });
                term.show();
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.revealInExplorer', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                await vscode.commands.executeCommand('revealInExplorer', uri);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.copyPath', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                await vscode.env.clipboard.writeText(uri.fsPath);
            } else if (item && 'pathValue' in item && item.pathValue) {
                await vscode.env.clipboard.writeText(item.pathValue);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.copyRelativePath', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                const rel = vscode.workspace.asRelativePath(uri);
                await vscode.env.clipboard.writeText(rel);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.rename', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri || uri.scheme !== 'file') {
                return;
            }
            const oldName = path.basename(uri.fsPath);
            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new name',
                value: oldName
            });
            if (!newName || newName.trim() === '' || newName.trim() === oldName) {
                return;
            }
            const newUri = vscode.Uri.file(path.join(path.dirname(uri.fsPath), newName.trim()));
            try {
                await vscode.workspace.fs.rename(uri, newUri, { overwrite: false });
                treeDataProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to rename: ${err.message || err}`);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.delete', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri || uri.scheme !== 'file') {
                return;
            }
            const name = path.basename(uri.fsPath);
            const choice = await vscode.window.showWarningMessage(
                `Are you sure you want to delete '${name}'?`,
                { modal: true },
                'Move to Trash'
            );
            if (choice === 'Move to Trash') {
                try {
                    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
                    treeDataProvider.refresh();
                } catch (err: any) {
                    vscode.window.showErrorMessage(`Failed to delete: ${err.message || err}`);
                }
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.cut', (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                navigatorClipboard = { sourceUri: uri, isCut: true };
                vscode.window.setStatusBarMessage(`$(cut) Cut '${path.basename(uri.fsPath)}' to clipboard`, 3000);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.copy', (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (uri && uri.scheme === 'file') {
                navigatorClipboard = { sourceUri: uri, isCut: false };
                vscode.window.setStatusBarMessage(`$(copy) Copied '${path.basename(uri.fsPath)}' to clipboard`, 3000);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.paste', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            if (!navigatorClipboard) {
                vscode.window.showInformationMessage('Ignis Navigator clipboard is empty.');
                return;
            }
            const targetDir = resolveTargetDirectory(item);
            if (!targetDir) {
                vscode.window.showErrorMessage('Unable to determine destination directory.');
                return;
            }
            const fileName = path.basename(navigatorClipboard.sourceUri.fsPath);
            let destPath = path.join(targetDir, fileName);
            if (fs.existsSync(destPath) && !navigatorClipboard.isCut) {
                const ext = path.extname(fileName);
                const base = path.basename(fileName, ext);
                destPath = path.join(targetDir, `${base}_copy${ext}`);
            }
            const destUri = vscode.Uri.file(destPath);
            try {
                if (navigatorClipboard.isCut) {
                    await vscode.workspace.fs.rename(navigatorClipboard.sourceUri, destUri, { overwrite: true });
                    navigatorClipboard = null;
                } else {
                    await vscode.workspace.fs.copy(navigatorClipboard.sourceUri, destUri, { overwrite: true });
                }
                treeDataProvider.refresh();
            } catch (err: any) {
                vscode.window.showErrorMessage(`Failed to paste: ${err.message || err}`);
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.runJava', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri) return;
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            try {
                await vscode.commands.executeCommand('java.debug.runJavaFile', uri);
            } catch {
                await vscode.commands.executeCommand('workbench.action.debug.run');
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.debugJava', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri) return;
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            try {
                await vscode.commands.executeCommand('java.debug.debugJavaFile', uri);
            } catch {
                await vscode.commands.executeCommand('workbench.action.debug.start');
            }
        }),
        vscode.commands.registerCommand('ignis.java.navigator.organizeImports', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri) return;
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('editor.action.organizeImports');
            await doc.save();
            vscode.window.setStatusBarMessage(`$(symbol-namespace) Organized imports in ${path.basename(uri.fsPath)}`, 3000);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.format', async (item?: IgnisJavaTreeItem | vscode.Uri) => {
            const uri = resolveItemUri(item);
            if (!uri) return;
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            await vscode.commands.executeCommand('editor.action.formatDocument');
            await doc.save();
            vscode.window.setStatusBarMessage(`$(check) Formatted ${path.basename(uri.fsPath)}`, 3000);
        }),
        vscode.commands.registerCommand('ignis.java.navigator.projectSettings', async () => {
            try {
                await vscode.commands.executeCommand('java.projectSettings');
            } catch {
                try {
                    await vscode.commands.executeCommand('java.open.projectSettings');
                } catch {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'java');
                }
            }
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

