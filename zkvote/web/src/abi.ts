const proof = "tuple(uint256 merkleTreeDepth,uint256 merkleTreeRoot,uint256 nullifier,uint256 message,uint256 scope,uint256[8] points)"
export const ABI = [
  "function proposalCount() view returns (uint256)",
  "function getProposal(uint256) view returns (tuple(address creator,string title,string description,string[] options,uint64 registrationEnd,uint64 votingEnd,uint256 groupId,uint32 voters,bool restricted,uint256[] tally))",
  "function registered(uint256,address) view returns (bool)",
  "function createProposal(string,string,string[],uint64,uint64,address[]) returns (uint256)",
  "function register(uint256,uint256)",
  `function castVote(uint256,uint256,${proof})`,
  "event Registered(uint256 indexed id, uint256 commitment)",
  "event VoteCast(uint256 indexed id, uint256 indexed nullifier, uint256 choice)"
]
