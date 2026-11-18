import { describeTransactionIsolation } from '../suites/transaction-isolation';
import { mariadbLiveServer } from './server';

describeTransactionIsolation(mariadbLiveServer);
