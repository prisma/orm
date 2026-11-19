import { describeNestedTransactions } from '../suites/nested-transactions';
import { mariadbLiveServer } from './server';

describeNestedTransactions(mariadbLiveServer);
