import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const cache = new Map();

function collectProtoFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectProtoFiles(path);
    }
    return entry.name.endsWith('.proto') ? [path] : [];
  });
}

function contractNames(directory) {
  if (!cache.has(directory)) {
    const names = new Set();
    for (const file of collectProtoFiles(directory)) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const match of source.matchAll(/\b(?:message|enum)\s+([A-Za-z_]\w*)/g)) {
        names.add(match[1]);
      }
    }
    cache.set(directory, names);
  }
  return cache.get(directory);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hand-written types that shadow contract message names',
    },
    schema: [
      {
        type: 'object',
        properties: {
          contractsDir: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      shadow: "'{{name}}' is a contract message. Import the generated type instead of declaring it by hand.",
    },
  },

  create(context) {
    const options = context.options[0] ?? {};
    const directory = resolve(context.cwd, options.contractsDir ?? 'contracts');
    const names = contractNames(directory);

    if (names.size === 0) {
      return {};
    }

    const check = (node) => {
      if (node.id && names.has(node.id.name)) {
        context.report({ node: node.id, messageId: 'shadow', data: { name: node.id.name } });
      }
    };

    return {
      TSInterfaceDeclaration: check,
      TSTypeAliasDeclaration: check,
      TSEnumDeclaration: check,
      ClassDeclaration: check,
    };
  },
};