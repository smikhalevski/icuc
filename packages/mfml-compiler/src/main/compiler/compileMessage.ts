import {RuntimeMethod} from 'mfml-runtime';
import {createMap, Maybe} from '../misc';
import {compileDocComment, compilePropertyName, createVarNameProvider} from '@smikhalevski/codegen';
import {compileLocaleNodeMap, ILocaleNodeMap, ILocaleNodeMapCompilerOptions} from './compileLocaleNodeMap';
import {runtimeMethods} from './runtimeMethods';

export interface IMessageMetadata {

  /**
   * The name of the TypeScript interface that describe the message arguments or `null` if message has no arguments.
   */
  interfaceName: string | null;

  /**
   * The name of the message rendering function.
   */
  functionName: string;

  /**
   * The list of argument names.
   */
  argumentNames: Array<string>;
}

export interface IMessageCompilerOptions extends Pick<ILocaleNodeMapCompilerOptions,
    | 'otherSelectCaseKey'
    | 'indexVarName'
    | 'localeVarName'
    | 'defaultLocale'
    | 'locales'
    | 'localesVarName'> {

  /**
   * The name of the TypeScript interface that describe the message arguments.
   */
  interfaceName: string;

  /**
   * The name of the message rendering function.
   */
  functionName: string;

  /**
   * The name of the variable that holds the runtime object.
   */
  runtimeVarName: string;

  /**
   * The name of the variable that holds the arguments object.
   */
  argsVarName: string;

  /**
   * The doc comment of the rendering function.
   */
  comment: Maybe<string>;

  /**
   * Returns the TypeScript type of the argument that a function expects.
   *
   * @param functionName The name of the function.
   */
  provideFunctionType?(functionName: string): Maybe<string>;

  /**
   * Returns arbitrary source code that is rendered after message function rendering is completed.
   */
  renderMetadata?(metadata: IMessageMetadata): Maybe<string>;
}

/**
 * Compiles a message function and an interface that describes its arguments.
 *
 * @param localeNodeMap The map from locale to an AST node.
 * @param options Compilation options.
 */
export function compileMessage(localeNodeMap: ILocaleNodeMap, options: Readonly<IMessageCompilerOptions>): string {

  const {
    otherSelectCaseKey,
    provideFunctionType,
    renderMetadata,
    interfaceName,
    functionName,
    localeVarName,
    runtimeVarName,
    argsVarName,
    indexVarName,
    comment,
    localesVarName,
    locales,
    defaultLocale,
  } = options;

  const varNameProvider = createVarNameProvider([
    localeVarName,
    runtimeVarName,
    argsVarName,
    indexVarName,
    localesVarName,
  ].concat(runtimeMethods));

  const argVarNameMap = createMap<string>();
  const argTypeMap = createMap<Set<string>>();
  const usedRuntimeMethods = new Set<RuntimeMethod>();

  let indexVarUsed = false;

  const pushArgType = (argumentName: string, type: string) => {
    (argTypeMap[argumentName] ||= new Set()).add(type);
  };

  const resultSrc = compileLocaleNodeMap(localeNodeMap, {
    localeVarName,
    indexVarName,
    defaultLocale,
    locales,
    localesVarName,
    otherSelectCaseKey,

    provideArgumentVarName(name) {
      return argVarNameMap[name] ||= varNameProvider.next();
    },

    onFunctionUsed(node) {
      const type = provideFunctionType?.(node.name);
      if (type) {
        pushArgType(node.argumentName, type);
      }
    },

    onSelectUsed(node) {
      pushArgType(node.argumentName, 'number');
    },

    onRuntimeMethodUsed(runtimeMethod, varUsed) {
      usedRuntimeMethods.add(runtimeMethod);
      indexVarUsed ||= varUsed;
    },
  });

  const usedArgNames = Object.keys(argVarNameMap);
  const unusedArgNames = Object.keys(argTypeMap).filter((name) => !usedArgNames.includes(name));

  const interfaceUsed = usedArgNames.length || unusedArgNames.length;
  const argumentNames = usedArgNames.concat(unusedArgNames);

  let src = '';

  // Interface
  if (interfaceUsed) {
    src += `export interface ${interfaceName}{`;

    for (const name of argumentNames) {
      src += compilePropertyName(name) + ':' + compileType(argTypeMap[name]) + ';';
    }
    src += '}';
  }

  // Comment
  src += compileDocComment(comment);

  // Function
  src += `let ${functionName}:MessageFunction`
      + (interfaceUsed ? '<' + interfaceName + '>' : '')
      + '=('
      + runtimeVarName + ','
      + localeVarName
      + (interfaceUsed ? ',' + argsVarName : '')
      + ')=>{';

  // Index var
  if (indexVarUsed) {
    src += `let ${indexVarName};`;
  }

  // Runtime method vars
  if (usedRuntimeMethods.size) {
    src += 'const{' + Array.from(usedRuntimeMethods).join(',') + '}=' + runtimeVarName + ';';
  }

  // Used argument vars
  if (usedArgNames.length) {
    src += 'const{'
        + usedArgNames.map((name) =>
            compilePropertyName(name)
            + ':'
            + argVarNameMap[name],
        ).join(',')
        + '}='
        + argsVarName
        + ';';
  }

  src += `return ${resultSrc}};`;

  // Metadata
  if (renderMetadata) {
    src += renderMetadata({
      interfaceName: interfaceUsed ? interfaceName : null,
      functionName,
      argumentNames,
    });
  }

  return src;
}

function compileType(types: Set<string> | undefined): string {
  if (!types) {
    return 'unknown';
  }
  if (types.size === 1) {
    return types.values().next().value;
  }
  return Array.from(types).map((type) => type.indexOf('|') !== -1 ? '(' + type + ')' : type).join('&');
}
