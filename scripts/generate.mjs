#!/usr/bin/env node
// Usage: node scripts/generate.mjs [path to the agy binary] > _agy

import { spawnSync } from 'node:child_process';

const MAX_DESCRIPTION_LENGTH = 120;
const COMMAND_TIMEOUT_MS = 15_000;
const HELP_COMMAND = 'help';
const PROBE_FLAGS = ['--zz-probe-a', '--zz-probe-b'];

const binary = process.argv[2] ?? 'agy';

function run(args) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(`\`${binary} ${args.join(' ')}\` failed: ${result.error.message}`);
  }
  return `${result.stdout}${result.stderr}`;
}

function summarize(text) {
  let summary = text.replace(/\s*\(default \[\]\)/, '').replace(/\s+/g, ' ').trim();
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    const sentence = summary.match(/^(.{20,}?[.;])\s+[A-Za-z`]/);
    if (sentence) {
      summary = sentence[1];
    }
  }
  if (summary.length > MAX_DESCRIPTION_LENGTH) {
    summary = `${summary.slice(0, MAX_DESCRIPTION_LENGTH).replace(/\s+\S*$/, '')}...`;
  }
  return summary;
}

// Help is laid out as unindented "Header:" lines, each followed by entries indented two spaces
// with the description separated from the name by at least two more.
function parseSections(text) {
  const sections = new Map();
  let entries;
  for (const line of text.split('\n')) {
    const header = line.match(/^(\S.*):$/);
    if (header) {
      entries = [];
      sections.set(header[1], entries);
      continue;
    }
    const entry = line.match(/^ {2}(\S(?:.*?\S)?)(?: {2,}(\S.*))?$/);
    if (entry && entries) {
      entries.push({ head: entry[1], description: entry[2] ?? '' });
    }
  }
  return sections;
}

function choicesIn(description) {
  const withoutDefault = description.replace(/\(default [^)]*\)/g, '');
  const listed = withoutDefault.match(/\(([a-z0-9-]+(?:(?:\||, )[a-z0-9-]+)+)\)/);
  if (listed) {
    return listed[1].split(/\||, /);
  }
  const quoted = [...withoutDefault.matchAll(/'([a-z0-9-]+)'/g)].map(match => match[1]);
  return quoted.length > 1 ? quoted : null;
}

function valueAction(description, choices) {
  if (choices) {
    return `(${choices.join(' ')})`;
  }
  if (/\bdirectory\b/i.test(description)) {
    return '_files -/';
  }
  if (/\bfile\b/i.test(description)) {
    return '_files';
  }
  return ' ';
}

// The help never says which flags take a value, so outside the root this is read off the wording.
function describesValue(description, choices) {
  return (
    choices !== null ||
    /\(repeatable\)/.test(description) ||
    /\(default (?!(?:true|false)\))[^)]*\)/.test(description) ||
    /\b(directory|file)\b/i.test(description) ||
    /^Set /.test(description)
  );
}

function optionsFrom(entries) {
  const options = [];
  const shortEntries = [];
  for (const { head, description } of entries) {
    if (!head.startsWith('--')) {
      shortEntries.push({ head, description });
      continue;
    }
    const choices = choicesIn(description);
    options.push({
      flags: [head],
      description,
      choices,
      takesValue: describesValue(description, choices),
      repeatable: /\(repeatable\)|\(default \[\]\)/.test(description),
      aliasOf: description.match(/^Alias for (--[\w-]+)/)?.[1] ?? null,
    });
  }
  for (const { head, description } of shortEntries) {
    const target = description.match(/^Short alias for (--[\w-]+)/)?.[1];
    const long = options.find(option =>
      target ? option.flags.includes(target) : option.description === description
    );
    if (long) {
      long.flags.unshift(head);
    } else {
      const choices = choicesIn(description);
      options.push({
        flags: [head],
        description,
        choices,
        takesValue: describesValue(description, choices),
        repeatable: false,
        aliasOf: null,
      });
    }
  }
  for (const option of options) {
    const target = options.find(other => other.flags.includes(option.aliasOf));
    if (target) {
      option.takesValue = target.takesValue;
      option.repeatable = target.repeatable;
      option.choices = target.choices;
    }
  }
  return options;
}

// The root parser rejects unknown flags before doing anything else, and its error names them.
// A flag that takes a value swallows the first probe flag, so only the second is reported.
function probeTakesValue(flag) {
  const output = run([flag, ...PROBE_FLAGS]);
  const [first, second] = PROBE_FLAGS.map(probe => output.includes(`-${probe.replace(/^--/, '')}`));
  if (/^invalid value /m.test(output) || (!first && second)) {
    return true;
  }
  if (first && second) {
    return false;
  }
  return null;
}

function argumentsFrom(placeholders) {
  return placeholders.map(placeholder => {
    const name = placeholder.replace(/^[<[]|[>\]]$/g, '').replace(/\.\.\.$/, '');
    return {
      name,
      required: placeholder.startsWith('<'),
      multiple: placeholder.includes('...'),
      action: name === 'path' ? '_files' : ' ',
    };
  });
}

function placeholdersIn(text) {
  return (text.match(/<[^>]+>|\[[^\]]+\]/g) ?? []).filter(
    placeholder => !/^(\[flags\]|\[args\]|\[arguments\]|<subcommand>|<command>)$/.test(placeholder)
  );
}

function commandFrom(commandPath, text, description) {
  const sections = parseSections(text);
  const usage = text.match(/^Usage: \S+ (.*)$/m)?.[1] ?? '';
  const childEntries = sections.get('Available subcommands') ?? sections.get('Commands') ?? [];
  const mayQueryChildren = text.includes(`${commandPath.join(' ')} <subcommand> --help"`);

  const subcommands = childEntries.map(entry => {
    const [name] = entry.head.split(' ');
    const childPath = [...commandPath, name];
    if (mayQueryChildren) {
      return commandFrom(childPath, run([...childPath, '--help']), entry.description);
    }
    return {
      name,
      aliases: [],
      description: summarize(entry.description),
      options: [],
      args: argumentsFrom(placeholdersIn(entry.head)),
      subcommands: [],
    };
  });

  return {
    name: commandPath.at(-1),
    aliases: [],
    description: summarize(description),
    options: optionsFrom(sections.get('Flags') ?? []),
    args: subcommands.length > 0 ? [] : argumentsFrom(placeholdersIn(usage)),
    subcommands,
  };
}

function quote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function optionSpec(option) {
  const description = summarize(option.description);
  const explanation = description
    ? `[${description.replace(/\\/g, '\\\\').replace(/]/g, '\\]')}]`
    : '';
  const label = option.flags.at(-1).replace(/^-+/, '');
  const value = option.takesValue
    ? `:${label}:${valueAction(option.description, option.choices)}`
    : '';
  const names = option.flags.map(flag => `${flag}${option.takesValue ? '=' : ''}`);
  const repeat = option.repeatable ? '*' : '';
  if (names.length === 1) {
    return quote(`${repeat}${names[0]}${explanation}${value}`);
  }
  const prefix = option.repeatable ? '*' : `(${option.flags.join(' ')})`;
  return `${quote(prefix)}{${names.join(',')}}${quote(`${explanation}${value}`)}`;
}

function argumentSpec(argument) {
  const label = argument.name.replace(/:/g, '\\:');
  if (argument.multiple) {
    return quote(`*:${label}:${argument.action}`);
  }
  return quote(`${argument.required ? ':' : '::'}${label}:${argument.action}`);
}

function emitNode(node, commandPath, lines) {
  const body = [];
  if (node.subcommands.length > 0) {
    body.push('subs=(');
    for (const subcommand of node.subcommands) {
      for (const name of [subcommand.name, ...subcommand.aliases]) {
        body.push(`  ${quote(`${name}:${subcommand.description}`)}`);
      }
    }
    body.push(')');
    const aliases = node.subcommands.flatMap(subcommand =>
      subcommand.aliases.map(alias => `${alias} ${subcommand.name}`)
    );
    if (aliases.length > 0) {
      body.push(`alias_pairs=(${aliases.join(' ')})`);
    }
  }
  if (node.options.length > 0) {
    body.push('opts=(', ...node.options.map(option => `  ${optionSpec(option)}`), ')');
  }
  const positionals = node.subcommands.length > 0 ? [quote(': :->command')] : node.args.map(argumentSpec);
  if (positionals.length > 0) {
    body.push(`args=(${positionals.join(' ')})`);
  }

  if (body.length > 0) {
    lines.push(`    ${quote(commandPath)})`, ...body.map(line => `      ${line}`), '      ;;');
  }
  for (const subcommand of node.subcommands) {
    const subcommandPath = commandPath ? `${commandPath} ${subcommand.name}` : subcommand.name;
    emitNode(subcommand, subcommandPath, lines);
  }
}

const version = run(['--version']).trim();
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Unexpected \`${binary} --version\` output: ${version}`);
}

const rootHelp = run(['--help']);
const rootSections = parseSections(rootHelp);
const rootFlagEntries = rootSections.get('Usage of agy');
const rootCommandEntries = rootSections.get('Available subcommands');
if (!rootFlagEntries?.length || !rootCommandEntries?.length) {
  throw new Error(`Cannot find the flag and subcommand lists in \`${binary} --help\``);
}

const rootOptions = optionsFrom(rootFlagEntries);
for (const option of rootOptions) {
  const probed = probeTakesValue(option.flags.at(-1));
  if (probed === null) {
    process.stderr.write(`Could not probe ${option.flags.at(-1)}; guessing from its description\n`);
  } else {
    option.takesValue = probed;
  }
}
// Neither is listed in the root help, but this script only got here by running both.
rootOptions.push(
  { flags: ['-h', '--help'], description: 'Show help', choices: null, takesValue: false, repeatable: false },
  { flags: ['--version'], description: 'Show the CLI version', choices: null, takesValue: false, repeatable: false }
);

const commands = [];
for (const entry of rootCommandEntries) {
  if (entry.head === HELP_COMMAND) {
    commands.push({
      name: HELP_COMMAND,
      aliases: [],
      description: summarize(entry.description),
      options: [],
      args: [],
      subcommands: [],
    });
    continue;
  }
  const help = run([HELP_COMMAND, entry.head]);
  const canonical = help.match(/^Usage: \S+ (\S+)/m)?.[1];
  const aliased = entry.description.match(/^Alias for (\S+)/)?.[1] ?? canonical;
  if (aliased && aliased !== entry.head && rootCommandEntries.some(other => other.head === aliased)) {
    commands.push({ aliasFor: aliased, name: entry.head });
    continue;
  }
  commands.push(commandFrom([entry.head], help, entry.description));
}
const topLevel = commands.filter(command => !command.aliasFor);
for (const alias of commands.filter(command => command.aliasFor)) {
  topLevel.find(command => command.name === alias.aliasFor).aliases.push(alias.name);
}

const nodeLines = [];
emitNode(
  { name: '', aliases: [], description: '', options: rootOptions, args: [], subcommands: topLevel },
  '',
  nodeLines
);

process.stdout.write(`#compdef agy

# Generated from the help output of Antigravity CLI ${version}.

_agy_node() {
  subs=() alias_pairs=() opts=() args=()
  case $1 in
${nodeLines.join('\n')}
  esac
}

_agy_load() {
  local spec flag
  _agy_node "$node"
  alias_of=($alias_pairs)
  value_flags=()
  for spec in $opts; do
    spec=\${spec#\\(*\\)}
    flag=\${\${spec#\\*}%%[\\[:]*}
    [[ $flag == *= ]] && value_flags+=(\${flag%=})
  done
}

_agy() {
  local curcontext=$curcontext state state_descr line node word
  local -a subs alias_pairs opts args value_flags
  local -A opt_args alias_of
  local -i i=2 start=1 positional=0 ret=1

  _agy_load
  while (( i < CURRENT )); do
    word=$words[i]
    if [[ $word == -- ]]; then
      break
    elif [[ $word == -?* ]]; then
      [[ $word != *=* ]] && (( $value_flags[(Ie)$word] )) && (( i++ ))
    elif (( ! positional )); then
      word=\${alias_of[$word]:-$word}
      if [[ -z $node && $word == ${HELP_COMMAND} ]]; then
        start=$i
      elif (( $subs[(I)\${(b)word}:*] )); then
        node="\${node:+$node }$word"
        start=$i
        _agy_load
      else
        positional=1
      fi
    fi
    (( i++ ))
  done

  words=($words[1] "\${(@)words[start+1,-1]}")
  (( CURRENT -= start - 1 ))

  _arguments -S -C : $opts $args && ret=0
  if [[ $state == command ]]; then
    _describe -t commands 'agy command' subs && ret=0
  fi
  return ret
}

_agy "$@"
`);
