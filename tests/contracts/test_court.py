"""Direct contract doubles test deterministic admission and validator behavior, not network consensus."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import sys
import types
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
class UserError(Exception): pass
class Return:
    def __init__(self,calldata): self.calldata=calldata
class Address(str):
    def __new__(cls,value):
        if not isinstance(value,str) or len(value)!=42: raise ValueError("Invalid address")
        return super().__new__(cls,value.lower())
class TreeMap(dict):
    def __class_getitem__(cls,args): return cls
def deco(fn): return fn
gl=types.SimpleNamespace(Contract=object,public=types.SimpleNamespace(view=deco,write=deco),message=types.SimpleNamespace(sender_address=Address("0x"+"11"*20),contract_address=Address("0x"+"33"*20)),vm=types.SimpleNamespace(UserError=UserError,Return=Return),nondet=types.SimpleNamespace())
stub=types.ModuleType("genlayer")
stub.gl=gl;stub.Address=Address;stub.TreeMap=TreeMap
stub.Keccak256=lambda data: types.SimpleNamespace(hexdigest=lambda: hashlib.sha256(data).hexdigest())
sys.modules["genlayer"]=stub
spec=importlib.util.spec_from_file_location("court",ROOT/"contracts/quality_court.py")
court=importlib.util.module_from_spec(spec)
spec.loader.exec_module(court)
def hash_value(v):
    return "0x"+hashlib.sha256((v if isinstance(v,str) else court._canonical(v)).encode()).hexdigest()
def evidence():
    buyer="0x"+"44"*20;seller="0x"+"55"*20;contract=str(gl.message.contract_address)
    a=dict(schemaVersion=1,orderId="0x"+"66"*32,serviceId="launch-plan-v1",origin="https://demo.example",resource="https://demo.example/delivery",buyer=buyer,seller=seller,receiptSigner=seller,chainId=84532,network="eip155:84532",token=court.USDC,amount="10000",brief="A local log timeline, solo builder, five hours, zero ad budget. Give three actions and useful feedback.",rubricId="launch-plan-v1",rubric=list(court.RUBRIC),refundPolicy=court.REFUND_POLICY,deliveryDeadlineSeconds=1800,disputeWindowSeconds=86400,createdAt=1,expiresAt=600,courtNetwork="studionet",courtAddress=contract,publicEvidence=True)
    p=dict(chainId=84532,network="eip155:84532",token=court.USDC,payer=buyer,seller=seller,amount="10000",authorizationNonce="0x"+"77"*32,transactionHash="0x"+"88"*32,blockNumber="1",blockHash="0x"+"99"*32,verified=True)
    text="Promote your product on social media. Collect feedback."
    return dict(schemaVersion=1,caseId=court._payment_id(p),agreement=a,agreementHash=hash_value(a),delivery=dict(text=text,hash=hash_value(text),committedAt=2),buyerClaim=dict(action="dispute",materialFailure=True,criterionIds=["relevance"],reason="The answer is generic.",quotes=["Promote your product on social media."]),sellerDefense=None,payment=p)
class CourtTests(unittest.TestCase):
    def setUp(self):
        gl.message.sender_address=Address("0x"+"11"*20)
        self.contract=court.QualityCourt(str(gl.message.sender_address),"launch-plan-v1")
        self.contract.evidence=TreeMap();self.contract.evidence_hashes=TreeMap();self.contract.decisions=TreeMap()
        self.e=evidence()
    def register(self,e=None):
        e=e or self.e;raw=court._canonical(e);self.contract.register_case(e["caseId"],raw,hash_value(raw))
    def test_immutable_registrar_admission_and_idempotency(self):
        self.register();self.register()
        changed=copy.deepcopy(self.e);changed["sellerDefense"]="replacement"
        with self.assertRaises(UserError): self.register(changed)
        gl.message.sender_address=Address("0x"+"22"*20)
        with self.assertRaises(UserError): self.register()
    def test_admission_rejects_changed_hash_payment_quote_and_schema(self):
        for change in ("answer","payment","case","rubric","quote","oversize","extra","network"):
            e=copy.deepcopy(self.e)
            if change=="answer": e["delivery"]["text"]="Changed"
            if change=="payment": e["payment"]["verified"]=False
            if change=="case": e["caseId"]="0x"+"ab"*32
            if change=="rubric": e["agreement"]["rubric"][0]["text"]="Weakened"
            if change=="quote": e["buyerClaim"]["quotes"]=["Invented"]
            if change=="oversize": e["delivery"]["text"]="é"*1501
            if change=="extra": e["expectedVerdict"]="REFUND"
            if change=="network": e["agreement"]["courtNetwork"]="testnet-bradbury"
            with self.subTest(change=change),self.assertRaises(UserError): self.register(e)
    def test_terminal_decision_never_reopens(self):
        self.register()
        calls=[]
        result=dict(decision="REFUND",materialFailure=True,reasoning="Generic advice omits material context.",failedCriteria=["relevance"])
        def nondet(leader,validator):
            calls.append(1);value=leader();self.assertTrue(validator(Return(value)));return value
        gl.nondet.exec_prompt=lambda *args,**kwargs:result
        gl.vm.run_nondet_unsafe=nondet
        self.contract.adjudicate(self.e["caseId"]);self.contract.adjudicate(self.e["caseId"])
        self.assertEqual(len(calls),1)
        self.assertEqual(self.contract.get_case(self.e["caseId"])["result"],result)
    def test_validator_reruns_exact_evidence_and_disagrees_on_substance(self):
        self.register();prompts=[];outputs=[
          dict(decision="REFUND",materialFailure=True,reasoning="Material relevance failure.",failedCriteria=["relevance"]),
          dict(decision="NO_REFUND",materialFailure=False,reasoning="Purpose satisfied.",failedCriteria=[])]
        def model(prompt,**kwargs):prompts.append(prompt);return outputs[len(prompts)-1]
        def nondet(leader,validator):
            value=leader();self.assertFalse(validator(Return(value)));raise UserError("consensus disagreement")
        gl.nondet.exec_prompt=model;gl.vm.run_nondet_unsafe=nondet
        with self.assertRaises(UserError): self.contract.adjudicate(self.e["caseId"])
        self.assertEqual(prompts[0],prompts[1])
        self.assertIn(self.e["delivery"]["text"],prompts[0])
        self.assertNotIn("expectedVerdict",prompts[0])
        self.assertEqual(self.contract.get_case(self.e["caseId"])["status"],"REGISTERED")
    def test_malformed_outputs_do_not_become_refund_or_no_refund(self):
        for output in ({},dict(decision="REFUND",materialFailure=False,reasoning="Bad",failedCriteria=[]),dict(decision="NO_REFUND",materialFailure=True,reasoning="Bad",failedCriteria=["relevance"]),dict(decision="INSUFFICIENT_EVIDENCE",materialFailure=False,reasoning="Unknown",failedCriteria=[],extra=1)):
            with self.subTest(output=output),self.assertRaises(UserError): court._parse_decision(output)
    def test_validator_refuses_leader_errors_and_invalid_material_fields(self):
        self.register()
        refund=dict(decision="REFUND",materialFailure=True,reasoning="Failure",failedCriteria=["relevance"])
        def nondet(leader,validator):
            self.assertFalse(validator(UserError("bad model")))
            self.assertFalse(validator(Return({})))
            return leader()
        gl.nondet.exec_prompt=lambda *args,**kwargs:refund;gl.vm.run_nondet_unsafe=nondet
        self.contract.adjudicate(self.e["caseId"])
if __name__=="__main__":unittest.main()
