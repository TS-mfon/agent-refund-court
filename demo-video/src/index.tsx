import {Composition, registerRoot} from 'remotion';
import {CaseVideo} from './video';
const Root=()=> <Composition id="AgentRefundCourt" component={CaseVideo} width={1920} height={1080} fps={30} durationInFrames={1320}
 defaultProps={{caseFile:null,origin:'https://agent-refund-court.vercel.app',capturedAt:'',assets:{overview:'captures/overview.png',delivery:'captures/delivery.png',receipts:'captures/receipts.png'}}}/>;
registerRoot(Root);
