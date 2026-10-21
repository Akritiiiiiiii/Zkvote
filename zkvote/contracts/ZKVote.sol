// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/// @title ZKVote
/// @notice Each proposal owns a Semaphore group. Voters register an identity commitment
/// during the registration window, then cast ballots with zero-knowledge proofs of group
/// membership. Semaphore's nullifier (scoped to the proposal's group) blocks double votes.
contract ZKVote {
    struct Proposal {
        address creator;
        string title;
        string description;
        string[] options;
        uint64 registrationEnd;
        uint64 votingEnd;
        uint256 groupId;
        uint32 voters;
        bool restricted;
        uint256[] tally;
    }

    ISemaphore public immutable semaphore;
    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public registered;
    mapping(uint256 => mapping(address => bool)) public allowed;

    event ProposalCreated(uint256 indexed id, address indexed creator, string title);
    event Registered(uint256 indexed id, uint256 commitment);
    event VoteCast(uint256 indexed id, uint256 indexed nullifier, uint256 choice);

    constructor(ISemaphore semaphore_) {
        semaphore = semaphore_;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        require(id < _proposals.length, "no such proposal");
        return _proposals[id];
    }

    /// @param allowlist optional; when non-empty only these addresses may register.
    function createProposal(
        string calldata title,
        string calldata description,
        string[] calldata options,
        uint64 registrationSecs,
        uint64 votingSecs,
        address[] calldata allowlist
    ) external returns (uint256 id) {
        require(bytes(title).length > 0 && bytes(title).length <= 120, "title length");
        require(options.length >= 2 && options.length <= 8, "2 to 8 options");
        require(registrationSecs >= 60 && votingSecs >= 60, "windows under 60s");
        require(allowlist.length <= 500, "allowlist too long");

        id = _proposals.length;
        Proposal storage p = _proposals.push();
        p.creator = msg.sender;
        p.title = title;
        p.description = description;
        for (uint256 i; i < options.length; i++) {
            require(bytes(options[i]).length > 0, "empty option");
            p.options.push(options[i]);
        }
        p.tally = new uint256[](options.length);
        p.registrationEnd = uint64(block.timestamp) + registrationSecs;
        p.votingEnd = p.registrationEnd + votingSecs;
        p.groupId = semaphore.createGroup(); // this contract is the group admin
        p.restricted = allowlist.length > 0;
        for (uint256 i; i < allowlist.length; i++) allowed[id][allowlist[i]] = true;

        emit ProposalCreated(id, msg.sender, title);
    }

    /// @notice One registration per wallet per proposal. Only the commitment enters the group.
    function register(uint256 id, uint256 commitment) external {
        Proposal storage p = _get(id);
        require(block.timestamp < p.registrationEnd, "registration closed");
        require(!p.restricted || allowed[id][msg.sender], "wallet not allowlisted");
        require(!registered[id][msg.sender], "already registered");

        registered[id][msg.sender] = true;
        p.voters++;
        semaphore.addMember(p.groupId, commitment);
        emit Registered(id, commitment);
    }

    /// @notice Anyone may submit a ballot; the proof, not msg.sender, proves eligibility.
    function castVote(uint256 id, uint256 choice, ISemaphore.SemaphoreProof calldata proof) external {
        Proposal storage p = _get(id);
        require(block.timestamp >= p.registrationEnd, "voting not started");
        require(block.timestamp < p.votingEnd, "voting closed");
        require(choice < p.options.length, "invalid option");
        require(proof.message == choice, "proof is for another option");
        require(proof.scope == p.groupId, "wrong proof scope");

        // Reverts on an invalid proof or an already-used nullifier in this group.
        semaphore.validateProof(p.groupId, proof);

        p.tally[choice]++;
        emit VoteCast(id, proof.nullifier, choice);
    }

    function _get(uint256 id) private view returns (Proposal storage) {
        require(id < _proposals.length, "no such proposal");
        return _proposals[id];
    }
}
