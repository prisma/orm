import { describeNestedTransactions } from '../suites/nested-transactions';
import { mysqlLiveServer } from './server';

describeNestedTransactions(mysqlLiveServer);
