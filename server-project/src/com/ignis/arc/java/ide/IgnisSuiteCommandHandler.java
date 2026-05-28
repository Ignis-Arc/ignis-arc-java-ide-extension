package com.ignis.arc.java.ide;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.core.resources.IProject;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jdt.core.*;
import org.eclipse.jdt.core.dom.*;
import org.eclipse.jdt.ls.core.internal.IDelegateCommandHandler;
import org.eclipse.jdt.ls.core.internal.JDTUtils;
import org.objectweb.asm.*;
import org.objectweb.asm.util.*;

public class IgnisSuiteCommandHandler implements IDelegateCommandHandler {

    @Override
    public Object executeCommand(String commandId, List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if ("ignis.java.complexity.calculate".equals(commandId)) {
            return calculateComplexity(arguments, monitor);
        } else if ("ignis.java.project.getStructure".equals(commandId)) {
            return getProjectStructure(monitor);
        } else if ("ignis.java.project.getLibraries".equals(commandId)) {
            return getProjectLibraries(arguments);
        } else if ("ignis.java.library.getPackages".equals(commandId)) {
            return getLibraryPackages(arguments);
        } else if ("ignis.java.library.getClasses".equals(commandId)) {
            return getLibraryClasses(arguments);
        } else if ("ignis.java.complexity.scanWorkspace".equals(commandId)) {
            return scanWorkspaceComplexity(arguments, monitor);
        } else if ("ignis.java.bytecode.get".equals(commandId)) {
            return getBytecode(arguments, monitor);
        }
        throw new UnsupportedOperationException("Unsupported command: " + commandId);
    }

    private Object calculateComplexity(List<Object> arguments, IProgressMonitor monitor) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String fileUri = (String) arguments.get(0);
        ICompilationUnit compilationUnit = JDTUtils.resolveCompilationUnit(fileUri);
        if (compilationUnit == null) {
            return null;
        }

        ASTParser parser = ASTParser.newParser(AST.JLS17);
        parser.setSource(compilationUnit);
        parser.setResolveBindings(false);
        CompilationUnit astRoot = (CompilationUnit) parser.createAST(monitor);

        List<Map<String, Object>> methodsMetrics = new ArrayList<>();

        astRoot.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getBody() == null) {
                    return true;
                }

                // Filter out synthesized/Lombok-generated methods
                if (node.getBody().getStartPosition() <= node.getName().getStartPosition()) {
                    return true;
                }

                int complexity = calculateCyclomaticComplexity(node);

                Map<String, Object> metric = new HashMap<>();
                metric.put("name", node.getName().getIdentifier());
                metric.put("complexity", complexity);
                metric.put("startLine", astRoot.getLineNumber(node.getName().getStartPosition()));
                metric.put("endLine", astRoot.getLineNumber(node.getStartPosition() + node.getLength()));

                methodsMetrics.add(metric);
                return true;
            }
        });

        return methodsMetrics;
    }

    private int calculateCyclomaticComplexity(MethodDeclaration method) {
        final int[] count = { 1 };
        method.getBody().accept(new ASTVisitor() {
            @Override
            public boolean visit(IfStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(ForStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(EnhancedForStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(WhileStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(DoStatement node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(CatchClause node) {
                count[0]++;
                return true;
            }
            @Override
            public boolean visit(SwitchCase node) {
                if (!node.isDefault()) {
                    count[0]++;
                }
                return true;
            }
            @Override
            public boolean visit(InfixExpression node) {
                InfixExpression.Operator op = node.getOperator();
                if (op == InfixExpression.Operator.CONDITIONAL_AND || op == InfixExpression.Operator.CONDITIONAL_OR) {
                    count[0]++;
                }
                return true;
            }
            @Override
            public boolean visit(ConditionalExpression node) {
                count[0]++;
                return true;
            }
        });
        return count[0];
    }

    private Object getProjectStructure(IProgressMonitor monitor) throws Exception {
        List<Map<String, Object>> projectList = new ArrayList<>();

        IProject[] projects = ResourcesPlugin.getWorkspace().getRoot().getProjects();
        for (IProject project : projects) {
            if (!project.isOpen() || !project.hasNature(JavaCore.NATURE_ID)) {
                continue;
            }

            Map<String, Object> projectMap = new HashMap<>();
            projectMap.put("name", project.getName());
            
            String projectPath = project.getLocation() != null ? project.getLocation().toOSString() : "";
            projectMap.put("path", projectPath);

            String type = "standard";
            if (new File(projectPath, "pom.xml").exists()) {
                type = "maven";
            } else if (new File(projectPath, "build.gradle").exists() || new File(projectPath, "build.gradle.kts").exists()) {
                type = "gradle";
            }
            projectMap.put("type", type);
            projectList.add(projectMap);
        }

        return projectList;
    }

    private Object getProjectLibraries(List<Object> arguments) throws Exception {
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> systemLibs = new ArrayList<>();
        List<Map<String, Object>> userLibs = new ArrayList<>();
        String jreName = "JDK System Library";
        java.util.Set<String> jrePaths = new java.util.HashSet<>();

        try {
            IJavaModel javaModel = JavaCore.create(ResourcesPlugin.getWorkspace().getRoot());
            IJavaProject[] javaProjects = javaModel.getJavaProjects();

            for (IJavaProject javaProject : javaProjects) {
                try {
                    for (IClasspathEntry entry : javaProject.getRawClasspath()) {
                        if (entry.getEntryKind() == IClasspathEntry.CPE_CONTAINER) {
                            if (entry.getPath().toString().contains("org.eclipse.jdt.launching.JRE_CONTAINER")) {
                                IClasspathContainer container = JavaCore.getClasspathContainer(entry.getPath(), javaProject);
                                if (container != null) {
                                    if ("JDK System Library".equals(jreName)) {
                                        jreName = container.getDescription();
                                    }
                                    for (IClasspathEntry jreEntry : container.getClasspathEntries()) {
                                        jrePaths.add(jreEntry.getPath().toOSString());
                                    }
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    // ignore
                }
            }

            // Phase 2: Traverse and classify package fragment roots
            for (IJavaProject javaProject : javaProjects) {
                try {
                    IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
                    for (IPackageFragmentRoot root : roots) {
                        if (root.getKind() == IPackageFragmentRoot.K_BINARY) {
                            String rootPath = root.getPath().toOSString();
                            Map<String, Object> libMap = new HashMap<>();
                            libMap.put("name", root.getElementName());
                            libMap.put("path", rootPath);
                            libMap.put("id", root.getHandleIdentifier());

                            // Classify JRE system libraries exactly by resolved container path containment
                            boolean isSystem = jrePaths.contains(rootPath);
                            if (!isSystem) {
                                try {
                                    IClasspathEntry rawEntry = root.getRawClasspathEntry();
                                    if (rawEntry != null) {
                                        String entryPath = rawEntry.getPath().toString();
                                        if (entryPath.contains("org.eclipse.jdt.launching.JRE_CONTAINER") || entryPath.contains("JRE_CONTAINER")) {
                                            isSystem = true;
                                        }
                                    }
                                } catch (Exception e) {
                                    // ignore
                                }
                            }
                            if (!isSystem) {
                                String pathStr = root.getPath().toString();
                                if (pathStr.startsWith("jrt:") || pathStr.contains("rt.jar") || pathStr.contains("jrt-fs.jar")) {
                                    isSystem = true;
                                }
                            }

                            if (isSystem) {
                                if (!containsId(systemLibs, root.getHandleIdentifier())) {
                                    systemLibs.add(libMap);
                                }
                            } else {
                                if (!containsId(userLibs, root.getHandleIdentifier())) {
                                    userLibs.add(libMap);
                                }
                            }
                        }
                    }
                } catch (Exception e) {
                    // ignore
                }
            }
        } catch (Exception e) {
            // ignore
        }

        result.put("jreName", jreName);
        result.put("systemLibraries", systemLibs);
        result.put("referencedLibraries", userLibs);
        return result;
    }

    private boolean containsId(List<Map<String, Object>> list, String id) {
        for (Map<String, Object> map : list) {
            if (id.equals(map.get("id"))) {
                return true;
            }
        }
        return false;
    }

    private Object getLibraryPackages(List<Object> arguments) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String handleId = (String) arguments.get(0);
        IPackageFragmentRoot root = null;
        
        if (handleId.startsWith("=") || handleId.startsWith("[")) {
            root = (IPackageFragmentRoot) JavaCore.create(handleId);
        } else {
            // It's an absolute path!
            org.eclipse.core.runtime.IPath path = org.eclipse.core.runtime.Path.fromOSString(handleId);
            for (IProject project : ResourcesPlugin.getWorkspace().getRoot().getProjects()) {
                if (project.isOpen() && project.hasNature(JavaCore.NATURE_ID)) {
                    IJavaProject javaProject = JavaCore.create(project);
                    root = javaProject.findPackageFragmentRoot(path);
                    if (root != null && root.exists()) {
                        break;
                    }
                }
            }
        }

        if (root == null || !root.exists()) {
            return null;
        }

        List<Map<String, Object>> packagesList = new ArrayList<>();
        for (IJavaElement child : root.getChildren()) {
            if (child instanceof IPackageFragment) {
                IPackageFragment pkg = (IPackageFragment) child;
                if (pkg.hasChildren()) {
                    String pkgName = pkg.getElementName();
                    if (pkgName != null && !pkgName.isEmpty()) {
                        Map<String, Object> pkgMap = new HashMap<>();
                        pkgMap.put("name", pkgName);
                        pkgMap.put("id", pkg.getHandleIdentifier());
                        packagesList.add(pkgMap);
                    }
                }
            }
        }
        return packagesList;
    }

    private Object getLibraryClasses(List<Object> arguments) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String handleId = (String) arguments.get(0);
        IPackageFragment pkg = (IPackageFragment) JavaCore.create(handleId);
        if (pkg == null || !pkg.exists()) {
            return null;
        }

        List<Map<String, Object>> classesList = new ArrayList<>();
        for (IJavaElement child : pkg.getChildren()) {
            if (child instanceof IClassFile) {
                IClassFile classFile = (IClassFile) child;
                Map<String, Object> classMap = new HashMap<>();
                classMap.put("name", classFile.getElementName());
                classMap.put("id", classFile.getHandleIdentifier());
                classMap.put("uri", JDTUtils.toUri(classFile));
                classesList.add(classMap);
            }
        }
        return classesList;
    }

    private Object scanWorkspaceComplexity(List<Object> arguments, IProgressMonitor monitor) throws Exception {
        int threshold = 10;
        if (arguments != null && !arguments.isEmpty()) {
            Object firstArg = arguments.get(0);
            if (firstArg instanceof Number) {
                threshold = ((Number) firstArg).intValue();
            } else if (firstArg instanceof String) {
                try {
                    threshold = Integer.parseInt((String) firstArg);
                } catch (NumberFormatException e) {
                    // ignore
                }
            }
        }

        List<Map<String, Object>> result = new ArrayList<>();
        IJavaModel javaModel = JavaCore.create(ResourcesPlugin.getWorkspace().getRoot());
        IJavaProject[] javaProjects = javaModel.getJavaProjects();

        for (IJavaProject javaProject : javaProjects) {
            if (!javaProject.getProject().isOpen()) {
                continue;
            }
            IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
            for (IPackageFragmentRoot root : roots) {
                if (root.getKind() == IPackageFragmentRoot.K_SOURCE) {
                    analyzePackageFragmentRootComplexity(root, threshold, result, monitor);
                }
            }
        }

        result.sort((a, b) -> {
            int compA = (Integer) a.get("complexity");
            int compB = (Integer) b.get("complexity");
            return Integer.compare(compB, compA);
        });

        return result;
    }

    private void analyzePackageFragmentRootComplexity(IPackageFragmentRoot root, int threshold, List<Map<String, Object>> result, IProgressMonitor monitor) throws Exception {
        for (IJavaElement child : root.getChildren()) {
            if (child instanceof IPackageFragment) {
                IPackageFragment pkg = (IPackageFragment) child;
                for (ICompilationUnit unit : pkg.getCompilationUnits()) {
                    analyzeUnitComplexity(unit, threshold, result, monitor);
                }
            }
        }
    }

    private void analyzeUnitComplexity(ICompilationUnit unit, int threshold, List<Map<String, Object>> result, IProgressMonitor monitor) throws Exception {
        ASTParser parser = ASTParser.newParser(AST.JLS17);
        parser.setSource(unit);
        parser.setResolveBindings(false);
        CompilationUnit astRoot = (CompilationUnit) parser.createAST(monitor);

        String fileUri = JDTUtils.toUri(unit);

        astRoot.accept(new ASTVisitor() {
            @Override
            public boolean visit(MethodDeclaration node) {
                if (node.getBody() == null) {
                    return true;
                }

                // Filter out synthesized/Lombok-generated methods
                if (node.getBody().getStartPosition() <= node.getName().getStartPosition()) {
                    return true;
                }

                int complexity = calculateCyclomaticComplexity(node);
                if (complexity >= threshold) {
                    Map<String, Object> metric = new HashMap<>();
                    metric.put("name", node.getName().getIdentifier());
                    metric.put("complexity", complexity);
                    metric.put("startLine", astRoot.getLineNumber(node.getName().getStartPosition()));
                    metric.put("endLine", astRoot.getLineNumber(node.getStartPosition() + node.getLength()));
                    metric.put("uri", fileUri);

                    String className = "";
                    ASTNode parent = node.getParent();
                    while (parent != null) {
                        if (parent instanceof TypeDeclaration) {
                            className = ((TypeDeclaration) parent).getName().getIdentifier();
                            break;
                        }
                        parent = parent.getParent();
                    }
                    metric.put("className", className);

                    result.add(metric);
                }
                return true;
            }
        });
    }

    private Object getBytecode(List<Object> arguments, IProgressMonitor monitor) {
        try {
            if (arguments == null || arguments.isEmpty()) {
                return "// Error: arguments list is null or empty.";
            }
            Object firstArg = arguments.get(0);
            if (firstArg == null) {
                return "// Error: First argument (fileUri) is null.";
            }
            String fileUri = firstArg.toString();

            Integer lineVal = null;
            if (arguments.size() > 1 && arguments.get(1) != null) {
                Object lineArg = arguments.get(1);
                if (lineArg instanceof Number) {
                    lineVal = ((Number) lineArg).intValue();
                } else if (lineArg instanceof String) {
                    try {
                        lineVal = Integer.parseInt((String) lineArg);
                    } catch (NumberFormatException e) {
                        // ignore
                    }
                }
            }
            final Integer line = lineVal;

            boolean filterLombokVal = true;
            if (arguments.size() > 2 && arguments.get(2) != null) {
                Object filterArg = arguments.get(2);
                if (filterArg instanceof Boolean) {
                    filterLombokVal = (Boolean) filterArg;
                } else if (filterArg instanceof String) {
                    filterLombokVal = Boolean.parseBoolean((String) filterArg);
                }
            }
            final boolean finalFilterLombok = filterLombokVal;

            byte[] classBytes = null;
            String methodName = null;
            String methodDesc = null;

            final List<String> handwrittenMethods = new ArrayList<>();

            ICompilationUnit unit = JDTUtils.resolveCompilationUnit(fileUri);
            if (unit != null) {
                ASTParser parser = ASTParser.newParser(AST.JLS17);
                parser.setSource(unit);
                parser.setResolveBindings(true);
                CompilationUnit astRoot = (CompilationUnit) parser.createAST(monitor);

                // Collect all handwritten method names for Lombok/synthetic filtering
                astRoot.accept(new ASTVisitor() {
                    @Override
                    public boolean visit(MethodDeclaration node) {
                        handwrittenMethods.add(node.getName().getIdentifier());
                        return true;
                    }
                });

                AbstractTypeDeclaration targetType = null;

                if (line != null) {
                    final int targetLine = line;
                    final MethodDeclaration[] targetNode = new MethodDeclaration[1];
                    astRoot.accept(new ASTVisitor() {
                        @Override
                        public boolean visit(MethodDeclaration node) {
                            if (node.getBody() == null) {
                                return true;
                            }
                            int startLine = astRoot.getLineNumber(node.getStartPosition());
                            int endLine = astRoot.getLineNumber(node.getStartPosition() + node.getLength());
                            if (targetLine >= startLine && targetLine <= endLine) {
                                targetNode[0] = node;
                            }
                            return true;
                        }
                    });

                    if (targetNode[0] != null) {
                        IMethodBinding methodBinding = targetNode[0].resolveBinding();
                        methodName = targetNode[0].getName().getIdentifier();
                        methodDesc = (methodBinding != null) ? getMethodDescriptor(methodBinding) : null;

                        ASTNode parent = targetNode[0].getParent();
                        while (parent != null) {
                            if (parent instanceof AbstractTypeDeclaration) {
                                targetType = (AbstractTypeDeclaration) parent;
                                break;
                            }
                            parent = parent.getParent();
                        }
                    }
                }

                if (targetType == null && !astRoot.types().isEmpty()) {
                    targetType = (AbstractTypeDeclaration) astRoot.types().get(0);
                }

                if (targetType != null) {
                    ITypeBinding typeBinding = targetType.resolveBinding();
                    classBytes = getClassBytesForType(typeBinding, unit.getJavaProject());
                }
            } else {
                IClassFile classFile = JDTUtils.resolveClassFile(fileUri);
                if (classFile != null) {
                    classBytes = classFile.getBytes();
                }
            }

            if (classBytes == null) {
                return "// Error: Could not find compiled class bytes for: " + fileUri 
                    + "\n// Is active unit resolved: " + (unit != null)
                    + "\n// Please make sure the Java project builds without errors and the class file is generated.";
            }

            int majorVersion = 0;
            if (classBytes.length > 7) {
                majorVersion = ((classBytes[6] & 0xFF) << 8) | (classBytes[7] & 0xFF);
            }
            String javaVer = getJavaVersion(majorVersion);
            String header = "// Compiled with Java " + javaVer + " (major version " + majorVersion + ")\n\n";

            String bytecodeText = null;
            try {
                ClassReader cr = new ClassReader(classBytes);
                java.io.StringWriter sw = new java.io.StringWriter();
                java.io.PrintWriter pw = new java.io.PrintWriter(sw);

                if (methodName != null) {
                    Printer printer = new Textifier(Opcodes.ASM9) {
                        @Override
                        protected Textifier createTextifier() {
                            return new IgnisMethodTextifier();
                        }
                    };
                    MethodBytecodeExtractor extractor = new MethodBytecodeExtractor(printer, pw, methodName, methodDesc);
                    cr.accept(extractor, 0);
                    bytecodeText = sw.toString();
                }

                if (bytecodeText == null || bytecodeText.trim().isEmpty()) {
                    java.io.StringWriter swFull = new java.io.StringWriter();
                    java.io.PrintWriter pwFull = new java.io.PrintWriter(swFull);
                    
                    Textifier textifier = new Textifier(Opcodes.ASM9) {
                        @Override
                        protected Textifier createTextifier() {
                            return new IgnisMethodTextifier();
                        }
                    };
                    
                    TraceClassVisitor tcv = new TraceClassVisitor(null, textifier, pwFull);
                    
                    // Hook custom OSGi filter ClassVisitor
                    final List<String> finalHandwritten = handwrittenMethods;
                    ClassVisitor filterCV = new ClassVisitor(Opcodes.ASM9, tcv) {
                        @Override
                        public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
                            if (finalFilterLombok && !finalHandwritten.isEmpty()) {
                                boolean isHandwritten = finalHandwritten.contains(name) || "<init>".equals(name) || "<clinit>".equals(name);
                                if (!isHandwritten) {
                                    return null; // Skip this Lombok/synthetic method completely
                                }
                            }
                            return super.visitMethod(access, name, descriptor, signature, exceptions);
                        }
                    };
                    
                    cr.accept(filterCV, 0);
                    bytecodeText = swFull.toString();
                    
                    // Prepend Constant Pool Explorer table to full class decompilation
                    String cpSection = ConstantPoolParser.parse(classBytes);
                    bytecodeText = cpSection + bytecodeText;
                }
            } catch (Exception e) {
                return header + "// Error textifying bytecode: " + e.getMessage();
            }

            return header + bytecodeText;
        } catch (Throwable t) {
            java.io.StringWriter sw = new java.io.StringWriter();
            java.io.PrintWriter pw = new java.io.PrintWriter(sw);
            t.printStackTrace(pw);
            return "// Unexpected exception in getBytecode:\n// " + sw.toString().replace("\n", "\n// ");
        }
    }

    private byte[] getClassBytesForType(ITypeBinding typeBinding, IJavaProject javaProject) throws Exception {
        if (typeBinding == null) {
            return null;
        }
        String binaryName = typeBinding.getBinaryName();
        if (binaryName == null) {
            return null;
        }

        IPackageFragmentRoot root = null;
        IJavaElement javaElement = typeBinding.getJavaElement();
        if (javaElement instanceof IType) {
            IType jdtType = (IType) javaElement;
            root = (IPackageFragmentRoot) jdtType.getAncestor(IJavaElement.PACKAGE_FRAGMENT_ROOT);
        }

        org.eclipse.core.runtime.IPath outputPath = null;
        if (root != null) {
            try {
                IClasspathEntry classpathEntry = root.getRawClasspathEntry();
                if (classpathEntry != null) {
                    outputPath = classpathEntry.getOutputLocation();
                }
            } catch (Exception e) {
                // ignore
            }
        }
        if (outputPath == null) {
            outputPath = javaProject.getOutputLocation();
        }

        org.eclipse.core.resources.IWorkspaceRoot workspaceRoot = ResourcesPlugin.getWorkspace().getRoot();
        org.eclipse.core.resources.IResource outputResource = workspaceRoot.findMember(outputPath);
        if (outputResource == null || outputResource.getLocation() == null) {
            return null;
        }
        File outputFolder = outputResource.getLocation().toFile();
        String classRelativePath = binaryName.replace('.', '/') + ".class";
        File classFile = new File(outputFolder, classRelativePath);
        if (!classFile.exists()) {
            return null;
        }
        return java.nio.file.Files.readAllBytes(classFile.toPath());
    }

    public static class ConstantPoolParser {
        public static String parse(byte[] bytes) {
            try {
                if (bytes == null || bytes.length < 10) return "";
                java.io.DataInputStream in = new java.io.DataInputStream(new java.io.ByteArrayInputStream(bytes));
                if (in.readInt() != 0xCAFEBABE) return "";
                in.readUnsignedShort(); // minor
                in.readUnsignedShort(); // major
                int cpCount = in.readUnsignedShort();
                
                int[] tags = new int[cpCount];
                int[][] refs = new int[cpCount][2];
                String[] strings = new String[cpCount];
                
                for (int i = 1; i < cpCount; i++) {
                    int tag = in.readUnsignedByte();
                    tags[i] = tag;
                    switch (tag) {
                        case 1: // UTF8
                            strings[i] = in.readUTF();
                            break;
                        case 3: // Integer
                        case 4: // Float
                            in.readInt();
                            break;
                        case 5: // Long
                        case 6: // Double
                            in.readLong();
                            i++; // double slot
                            break;
                        case 7: // Class
                        case 8: // String
                        case 16: // MethodType
                        case 19: // Module
                        case 20: // Package
                            refs[i][0] = in.readUnsignedShort();
                            break;
                        case 9: // Fieldref
                        case 10: // Methodref
                        case 11: // InterfaceMethodref
                        case 12: // NameAndType
                        case 17: // Dynamic
                        case 18: // InvokeDynamic
                            refs[i][0] = in.readUnsignedShort();
                            refs[i][1] = in.readUnsignedShort();
                            break;
                        case 15: // MethodHandle
                            in.readUnsignedByte();
                            refs[i][0] = in.readUnsignedShort();
                            break;
                        default:
                            return ""; // unknown tag, abort
                    }
                }
                
                StringBuilder sb = new StringBuilder();
                sb.append("// ==========================================\n");
                sb.append("// Constant Pool:\n");
                sb.append("// ==========================================\n");
                for (int i = 1; i < cpCount; i++) {
                    int tag = tags[i];
                    if (tag == 0) continue;
                    sb.append(String.format("// #%-4d = ", i));
                    switch (tag) {
                        case 1:
                            sb.append(String.format("%-18s \"%s\"", "Utf8", strings[i].replace("\n", "\\n")));
                            break;
                        case 7:
                            int classRef = refs[i][0];
                            sb.append(String.format("%-18s #%-12d // %s", "Class", classRef, strings[classRef]));
                            break;
                        case 8:
                            int strRef = refs[i][0];
                            sb.append(String.format("%-18s #%-12d // \"%s\"", "String", strRef, strings[strRef]));
                            break;
                        case 9:
                            sb.append(String.format("%-18s #%d.#%d", "Fieldref", refs[i][0], refs[i][1]));
                            break;
                        case 10:
                            sb.append(String.format("%-18s #%d.#%d", "Methodref", refs[i][0], refs[i][1]));
                            break;
                        case 11:
                            sb.append(String.format("%-18s #%d.#%d", "InterfaceMethodref", refs[i][0], refs[i][1]));
                            break;
                        case 12:
                            sb.append(String.format("%-18s #%d:#%d", "NameAndType", refs[i][0], refs[i][1]));
                            break;
                        case 18:
                            sb.append(String.format("%-18s #%d:#%d", "InvokeDynamic", refs[i][0], refs[i][1]));
                            break;
                        default:
                            sb.append("Other");
                            break;
                    }
                    sb.append("\n");
                }
                sb.append("// ==========================================\n\n");
                return sb.toString();
            } catch (Exception e) {
                return "// Error parsing Constant Pool: " + e.getMessage() + "\n\n";
            }
        }
    }

    private String getMethodDescriptor(IMethodBinding methodBinding) {
        if (methodBinding == null) {
            return null;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("(");
        for (ITypeBinding param : methodBinding.getParameterTypes()) {
            sb.append(getDescriptor(param));
        }
        sb.append(")");
        sb.append(getDescriptor(methodBinding.getReturnType()));
        return sb.toString();
    }

    private String getDescriptor(ITypeBinding type) {
        if (type == null) {
            return "";
        }
        if (type.isPrimitive()) {
            String name = type.getName();
            switch (name) {
                case "void": return "V";
                case "boolean": return "Z";
                case "char": return "C";
                case "byte": return "B";
                case "short": return "S";
                case "int": return "I";
                case "float": return "F";
                case "long": return "J";
                case "double": return "D";
                default: return "";
            }
        } else if (type.isArray()) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < type.getDimensions(); i++) {
                sb.append("[");
            }
            sb.append(getDescriptor(type.getElementType()));
            return sb.toString();
        } else {
            ITypeBinding erasure = type.getErasure();
            String binaryName = erasure.getBinaryName();
            if (binaryName == null) {
                binaryName = erasure.getQualifiedName();
                if (binaryName == null || binaryName.isEmpty()) {
                    binaryName = "java.lang.Object";
                }
            }
            return "L" + binaryName.replace('.', '/') + ";";
        }
    }

    private String getJavaVersion(int majorVersion) {
        switch (majorVersion) {
            case 45: return "1.1";
            case 46: return "1.2";
            case 47: return "1.3";
            case 48: return "1.4";
            case 49: return "5";
            case 50: return "6";
            case 51: return "7";
            case 52: return "8";
            case 53: return "9";
            case 54: return "10";
            case 55: return "11";
            case 56: return "12";
            case 57: return "13";
            case 58: return "14";
            case 59: return "15";
            case 60: return "16";
            case 61: return "17";
            case 62: return "18";
            case 63: return "19";
            case 64: return "20";
            case 65: return "21";
            case 66: return "22";
            case 67: return "23";
            default:
                if (majorVersion > 44) {
                    return String.valueOf(majorVersion - 44);
                }
                return "Unknown";
        }
    }

    public static class IgnisMethodTextifier extends Textifier {
        private final List<String[]> lvt = new ArrayList<>();

        public IgnisMethodTextifier() {
            super(Opcodes.ASM9);
        }

        @Override
        public void visitLineNumber(int line, Label start) {
            getText().add("    // IgnisSrcLine: " + line + "\n");
            super.visitLineNumber(line, start);
        }

        @Override
        public void visitLocalVariable(String name, String desc, String signature, Label start, Label end, int index) {
            lvt.add(new String[] { String.valueOf(index), name, desc });
            super.visitLocalVariable(name, desc, signature, start, end, index);
        }

        @Override
        public void visitMethodEnd() {
            if (!lvt.isEmpty()) {
                // Sort LVT by slot index numerically
                lvt.sort((a, b) -> {
                    try {
                        return Integer.compare(Integer.parseInt(a[0]), Integer.parseInt(b[0]));
                    } catch (Exception e) {
                        return a[0].compareTo(b[0]);
                    }
                });

                StringBuilder sb = new StringBuilder();
                sb.append("    // 📍 Local Variable Table (LVT):\n");
                sb.append("    // [Slot]  [Name]               [Type Descriptor]\n");
                for (String[] row : lvt) {
                    String slot = row[0];
                    String varName = row[1];
                    String varType = row[2];

                    String paddedSlot = String.format("%-6s", slot);
                    String paddedName = String.format("%-18s", varName);
                    sb.append("    //   ").append(paddedSlot).append(" ").append(paddedName).append(" ").append(varType).append("\n");
                }
                sb.append("\n");
                getText().add(0, sb.toString());
            }
            super.visitMethodEnd();
        }

        @Override
        protected Textifier createTextifier() {
            return new IgnisMethodTextifier();
        }
    }

    public static class MethodBytecodeExtractor extends ClassVisitor {
        private final String targetMethodName;
        private final String targetMethodDesc;
        private final Printer printer;
        private final java.io.PrintWriter printWriter;

        public MethodBytecodeExtractor(Printer printer, java.io.PrintWriter printWriter, String targetMethodName, String targetMethodDesc) {
            super(Opcodes.ASM9);
            this.printer = printer;
            this.printWriter = printWriter;
            this.targetMethodName = targetMethodName;
            this.targetMethodDesc = targetMethodDesc;
        }

        @Override
        public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
            if (name.equals(targetMethodName) && (targetMethodDesc == null || descriptor.equals(targetMethodDesc))) {
                Printer methodPrinter = printer.visitMethod(access, name, descriptor, signature, exceptions);
                return new TraceMethodVisitor(methodPrinter);
            }
            return null;
        }

        @Override
        public void visitEnd() {
            printer.visitClassEnd();
            printer.print(printWriter);
            printWriter.flush();
        }
    }
}
