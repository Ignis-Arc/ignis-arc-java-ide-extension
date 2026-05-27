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

                int complexity = calculateCyclomaticComplexity(node);

                Map<String, Object> metric = new HashMap<>();
                metric.put("name", node.getName().getIdentifier());
                metric.put("complexity", complexity);
                metric.put("startLine", astRoot.getLineNumber(node.getStartPosition()));
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
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String projectPath = (String) arguments.get(0);
        IProject project = null;
        
        for (IProject p : ResourcesPlugin.getWorkspace().getRoot().getProjects()) {
            if (p.isOpen() && p.getLocation() != null && p.getLocation().toOSString().equals(projectPath)) {
                project = p;
                break;
            }
        }
        
        if (project == null) {
            return null;
        }

        IJavaProject javaProject = JavaCore.create(project);
        Map<String, Object> result = new HashMap<>();
        
        List<Map<String, Object>> systemLibs = new ArrayList<>();
        List<Map<String, Object>> userLibs = new ArrayList<>();

        IPackageFragmentRoot[] roots = javaProject.getPackageFragmentRoots();
        for (IPackageFragmentRoot root : roots) {
            if (root.getKind() == IPackageFragmentRoot.K_BINARY) {
                Map<String, Object> libMap = new HashMap<>();
                libMap.put("name", root.getElementName());
                libMap.put("path", root.getPath().toOSString());
                libMap.put("id", root.getHandleIdentifier());

                // Classify library: System JDK/JRE vs Referenced Libraries
                boolean isSystem = false;
                String pathStr = root.getPath().toOSString().toLowerCase();
                if (pathStr.contains("jre") || pathStr.contains("jdk") || pathStr.contains("java-") || pathStr.contains("rt.jar")) {
                    isSystem = true;
                }

                if (isSystem) {
                    systemLibs.add(libMap);
                } else {
                    userLibs.add(libMap);
                }
            }
        }
        
        String jreName = "JRE System Library";
        try {
            for (IClasspathEntry entry : javaProject.getRawClasspath()) {
                if (entry.getEntryKind() == IClasspathEntry.CPE_CONTAINER) {
                    if (entry.getPath().toString().contains("org.eclipse.jdt.launching.JRE_CONTAINER")) {
                        IClasspathContainer container = JavaCore.getClasspathContainer(entry.getPath(), javaProject);
                        if (container != null) {
                            jreName = container.getDescription();
                            break;
                        }
                    }
                }
            }
        } catch (Exception e) {
            // ignore fallback
        }
        result.put("jreName", jreName);
        
        result.put("systemLibraries", systemLibs);
        result.put("referencedLibraries", userLibs);
        return result;
    }

    private Object getLibraryPackages(List<Object> arguments) throws Exception {
        if (arguments == null || arguments.isEmpty()) {
            return null;
        }
        String handleId = (String) arguments.get(0);
        IPackageFragmentRoot root = (IPackageFragmentRoot) JavaCore.create(handleId);
        if (root == null || !root.exists()) {
            return null;
        }

        List<Map<String, Object>> packagesList = new ArrayList<>();
        for (IJavaElement child : root.getChildren()) {
            if (child instanceof IPackageFragment) {
                IPackageFragment pkg = (IPackageFragment) child;
                if (pkg.hasChildren()) {
                    Map<String, Object> pkgMap = new HashMap<>();
                    pkgMap.put("name", pkg.getElementName());
                    pkgMap.put("id", pkg.getHandleIdentifier());
                    packagesList.add(pkgMap);
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
}
