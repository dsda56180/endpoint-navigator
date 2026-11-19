import { Scanner } from './model';
import { restScanner } from './scanners/rest';
import { stompScanner } from './scanners/stomp';
import { xxljobScanner } from './scanners/xxljob';
import { messagingScanner } from './scanners/messaging';
import { mybatisScanner } from './scanners/mybatis';
import { feignScanner } from './scanners/feign';
import { httpcallScanner } from './scanners/httpcall';
import { regexRuleScanner } from './scanners/regexRule';

export const ALL_SCANNERS: Scanner[] = [
  restScanner,
  feignScanner,
  httpcallScanner,
  stompScanner,
  xxljobScanner,
  messagingScanner,
  mybatisScanner,
  regexRuleScanner
];

export function selectScanners(enabled: string[]): Scanner[] {
  const set = new Set(enabled);
  return ALL_SCANNERS.filter((s) => set.has(s.id));
}
