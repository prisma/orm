import { describeWritesReadingWrittenTable } from '../suites/writes-reading-written-table';
import { mariadbLiveServer } from './server';

describeWritesReadingWrittenTable(mariadbLiveServer);
