import { describeWritesReadingWrittenTable } from '../suites/writes-reading-written-table';
import { mysqlLiveServer } from './server';

describeWritesReadingWrittenTable(mysqlLiveServer);
