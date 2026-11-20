import { describeRawLane } from '../suites/raw-lane';
import { mariadbLiveServer } from './server';

describeRawLane(mariadbLiveServer);
