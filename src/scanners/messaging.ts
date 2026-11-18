import { findAnnotation } from '../java/parser';
import { evalStrings, parseArgs, stringArg } from '../java/expr';
import { AnnotationNode, Endpoint, ScanContext, Scanner, makeSearchText } from '../model';

function destinations(
  ann: AnnotationNode,
  keys: string[],
  constants: Map<string, string>,
  unresolved: string[]
): string[] {
  const map = parseArgs(ann.args);
  const values: string[] = [];
  for (const key of keys) {
    const expr = map.get(key);
    if (expr) {
      for (const value of evalStrings(expr, constants, unresolved)) {
        if (value.trim()) {
          values.push(value.trim());
        }
      }
    }
  }
  return values;
}

export const messagingScanner: Scanner = {
  id: 'messaging',
  label: 'MQ/定时',
  scan(ctx: ScanContext): Endpoint[] {
    const endpoints: Endpoint[] = [];

    for (const type of ctx.parsed.types) {
      for (const method of type.methods) {
        const rabbit = findAnnotation(method.annotations, ['RabbitListener']);
        if (rabbit) {
          const unresolved: string[] = [];
          const queues = destinations(
            rabbit,
            ['queues', 'value', 'queuesToDeclare'],
            ctx.constants,
            unresolved
          );
          const exchange = stringArg(rabbit.args, ['exchange'], ctx.constants, unresolved);
          const routingKey = stringArg(rabbit.args, ['key', 'routingKey'], ctx.constants, unresolved);
          const targets = queues.length > 0 ? queues : exchange ? [`${exchange}/${routingKey ?? '*'}`] : [method.name];

          for (const target of targets) {
            endpoints.push({
              id: `${ctx.filePath}#${method.line}#mq#${target}`,
              kind: 'mq',
              kindLabel: 'MQ',
              name: `queue:${target}`,
              path: target,
              description: 'RabbitMQ 消费者',
              tags: [],
              className: type.className,
              methodName: method.name,
              filePath: ctx.filePath,
              line: method.line,
              module: ctx.module,
              unresolved,
              searchText: makeSearchText([target, exchange, type.className, method.name, 'rabbitmq'])
            });
          }
          continue;
        }

        const kafka = findAnnotation(method.annotations, ['KafkaListener']);
        if (kafka) {
          const unresolved: string[] = [];
          const topics = destinations(kafka, ['topics', 'topicPartitions', 'value'], ctx.constants, unresolved);
          const targets = topics.length > 0 ? topics : [method.name];
          for (const target of targets) {
            endpoints.push({
              id: `${ctx.filePath}#${method.line}#mq#${target}`,
              kind: 'mq',
              kindLabel: 'MQ',
              name: `topic:${target}`,
              path: target,
              description: 'Kafka 消费者',
              tags: [],
              className: type.className,
              methodName: method.name,
              filePath: ctx.filePath,
              line: method.line,
              module: ctx.module,
              unresolved,
              searchText: makeSearchText([target, type.className, method.name, 'kafka'])
            });
          }
          continue;
        }

        const rocket = findAnnotation(method.annotations, ['RocketMQMessageListener']);
        if (rocket) {
          const unresolved: string[] = [];
          const topic = stringArg(rocket.args, ['topic'], ctx.constants, unresolved) ?? method.name;
          endpoints.push({
            id: `${ctx.filePath}#${method.line}#mq#${topic}`,
            kind: 'mq',
            kindLabel: 'MQ',
            name: `topic:${topic}`,
            path: topic,
            description: 'RocketMQ 消费者',
            tags: [],
            className: type.className,
            methodName: method.name,
            filePath: ctx.filePath,
            line: method.line,
            module: ctx.module,
            unresolved,
            searchText: makeSearchText([topic, type.className, method.name, 'rocketmq'])
          });
          continue;
        }

        const scheduled = findAnnotation(method.annotations, ['Scheduled']);
        if (scheduled) {
          const unresolved: string[] = [];
          const cron = stringArg(scheduled.args, ['cron'], ctx.constants, unresolved);
          const fixedRate = stringArg(scheduled.args, ['fixedRate', 'fixedDelay'], ctx.constants, unresolved);
          const schedule = cron ?? fixedRate ?? '—';
          endpoints.push({
            id: `${ctx.filePath}#${method.line}#scheduled#${method.name}`,
            kind: 'scheduled',
            kindLabel: '定时任务',
            name: `cron:${schedule}`,
            path: schedule,
            description: `本地定时任务 ${method.name}`,
            tags: [],
            className: type.className,
            methodName: method.name,
            filePath: ctx.filePath,
            line: method.line,
            module: ctx.module,
            unresolved,
            searchText: makeSearchText([schedule, type.className, method.name, 'scheduled'])
          });
        }
      }
    }

    return endpoints;
  }
};
