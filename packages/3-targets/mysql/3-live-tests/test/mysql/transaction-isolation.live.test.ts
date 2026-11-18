import { describeTransactionIsolation } from '../suites/transaction-isolation';
import { mysqlLiveServer } from './server';

describeTransactionIsolation(mysqlLiveServer);
