const ts = require('typescript');
const { pathToFileURL } = require('node:url');

// NestJS 12's ESM dependencies need CommonJS output inside Jest, including
// import.meta.url used by their createRequire calls. Application code is
// still compiled by ts-jest with the project's NodeNext settings.
module.exports = {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
        sourceMap: true,
      },
      transformers: {
        before: [
          (context) => {
            const visit = (node) => {
              if (
                ts.isPropertyAccessExpression(node) &&
                ts.isMetaProperty(node.expression) &&
                node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
                node.name.text === 'url'
              ) {
                return context.factory.createStringLiteral(
                  pathToFileURL(sourcePath).href,
                );
              }
              return ts.visitEachChild(node, visit, context);
            };
            return (sourceFile) => ts.visitNode(sourceFile, visit);
          },
        ],
      },
    });
    return { code: result.outputText, map: result.sourceMapText };
  },
};
