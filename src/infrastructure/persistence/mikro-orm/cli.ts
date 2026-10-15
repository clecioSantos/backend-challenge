import { MikroORM } from '@mikro-orm/postgresql';
import { loadConfig } from '../../../config/env';
import { buildMikroOrmConfig } from '../mikro-orm.config';

/**
 * Migration runner used by the `migration:*` package scripts.
 *
 *   bun run src/infrastructure/persistence/mikro-orm/cli.ts <up|down|create|fresh|list|pending>
 *
 * Kept deliberately small: it wires the same configuration the application
 * uses, then delegates to MikroORM's migrator.
 */
const COMMANDS = ['up', 'down', 'create', 'fresh', 'list', 'pending'] as const;
type Command = (typeof COMMANDS)[number];

function resolveCommand(): Command {
  const command = process.argv[2];
  if (command === undefined || !COMMANDS.includes(command as Command)) {
    throw new Error(`Usage: cli.ts <${COMMANDS.join('|')}>`);
  }
  return command as Command;
}

async function main(): Promise<void> {
  const command = resolveCommand();
  const config = loadConfig();
  const orm = await MikroORM.init(buildMikroOrmConfig(config.database));

  try {
    const migrator = orm.getMigrator();
    const report = (label: string, value: unknown): void => {
      process.stdout.write(`${label}: ${JSON.stringify(value, null, 2)}\n`);
    };

    switch (command) {
      case 'up':
        report('applied', await migrator.up());
        break;
      case 'down':
        report('reverted', await migrator.down());
        break;
      case 'fresh':
        await migrator.down({ to: 0 });
        report('applied', await migrator.up());
        break;
      case 'create': {
        const created = await migrator.createMigration();
        process.stdout.write(`created ${created.fileName}\n`);
        break;
      }
      case 'list':
        report('executed', await migrator.getExecutedMigrations());
        break;
      case 'pending':
        report('pending', await migrator.getPendingMigrations());
        break;
    }
  } finally {
    await orm.close(true);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
