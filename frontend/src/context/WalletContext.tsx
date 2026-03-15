import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ethers } from 'ethers';
import { useAccount, useDisconnect, useWalletClient, useSwitchChain } from 'wagmi';
import { useConnectModal, useChainModal } from '@rainbow-me/rainbowkit';
import { NETWORK, FACTORY_ADDRESS, LENS_ADDRESS } from '../config/network';
import { FACTORY_ABI, LENS_ABI, MARKET_ABI } from '../config/abis';

interface WalletState {
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  address: string | null;
  isOwner: boolean;
  isOwnerLoading: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  switchNetwork: () => void;
  getFactoryContract: (withSigner?: boolean) => ethers.Contract | null;
  getLensContract: () => ethers.Contract;
  getMarketContract: (address: string, withSigner?: boolean) => ethers.Contract | null;
  readProvider: ethers.JsonRpcProvider;
}

const readProvider = new ethers.JsonRpcProvider(NETWORK.rpcUrl, {
  chainId: NETWORK.chainId,
  name: NETWORK.name,
}, {
  staticNetwork: true,
  batchMaxCount: 1,
});

const WalletContext = createContext<WalletState>({
  provider: null,
  signer: null,
  address: null,
  isOwner: false,
  isOwnerLoading: true,
  isConnected: false,
  isCorrectNetwork: false,
  isConnecting: false,
  error: null,
  connect: () => {},
  disconnect: () => {},
  switchNetwork: () => {},
  getFactoryContract: () => null,
  getLensContract: () => new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider),
  getMarketContract: () => null,
  readProvider,
});

export function useWallet() {
  return useContext(WalletContext);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  // ── wagmi hooks ──────────────────────────────────────────────
  const { address: wagmiAddress, isConnected: wagmiConnected, isConnecting: wagmiConnecting, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  // ── Local state for ethers bridge + owner check ──────────────
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isOwnerLoading, setIsOwnerLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Derived state ────────────────────────────────────────────
  const isCorrectNetwork = chain?.id === NETWORK.chainId;
  const address = wagmiAddress ?? null;
  const isConnected = wagmiConnected;
  const isConnecting = wagmiConnecting;

  // ── Bridge walletClient → ethers BrowserProvider + Signer ────
  useEffect(() => {
    if (!walletClient) {
      setSigner(null);
      setProvider(null);
      return;
    }

    const { account, chain: wChain, transport } = walletClient;

    if (!wChain) {
      setSigner(null);
      setProvider(null);
      return;
    }

    const network = {
      chainId: wChain.id,
      name: wChain.name,
    };
    const ethersProvider = new ethers.BrowserProvider(transport, network);
    setProvider(ethersProvider);

    let cancelled = false;
    ethersProvider
      .getSigner(account.address)
      .then((s) => { if (!cancelled) setSigner(s); })
      .catch(() => { if (!cancelled) setSigner(null); });

    return () => { cancelled = true; };
  }, [walletClient]);

  // ── Check if connected wallet is the factory owner ──────────
  useEffect(() => {
    if (!address) {
      setIsOwner(false);
      setIsOwnerLoading(false);
      return;
    }
    setIsOwnerLoading(true);
    let cancelled = false;
    const currentAddress = address;
    (async () => {
      try {
        const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
        const ownerAddr: string = await factory.owner();
        if (!cancelled) {
          setIsOwner(ownerAddr.toLowerCase() === currentAddress.toLowerCase());
        }
      } catch {
        if (!cancelled) {
          setIsOwner(false);
        }
      } finally {
        if (!cancelled) {
          setIsOwnerLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  // ── Actions (thin wrappers over RainbowKit / wagmi) ─────────
  const connect = useCallback(() => {
    setError(null);
    openConnectModal?.();
  }, [openConnectModal]);

  const disconnect = useCallback(() => {
    wagmiDisconnect();
    setError(null);
  }, [wagmiDisconnect]);

  const switchNetwork = useCallback(() => {
    setError(null);
    if (switchChain) {
      switchChain(
        { chainId: NETWORK.chainId },
        {
          onError: (err) => {
            setError(err?.message ?? 'Failed to switch network');
            openChainModal?.();
          },
        },
      );
    } else {
      openChainModal?.();
    }
  }, [switchChain, openChainModal]);

  // ── Contract helpers (unchanged) ────────────────────────────
  const getFactoryContract = useCallback(
    (withSigner = false): ethers.Contract | null => {
      if (withSigner) {
        if (!signer) return null;
        return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, signer);
      }
      return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
    },
    [signer],
  );

  const getLensContract = useCallback(
    (): ethers.Contract => {
      return new ethers.Contract(LENS_ADDRESS, LENS_ABI, readProvider);
    },
    [],
  );

  const getMarketContract = useCallback(
    (marketAddress: string, withSigner = false): ethers.Contract | null => {
      if (withSigner) {
        if (!signer) return null;
        return new ethers.Contract(marketAddress, MARKET_ABI, signer);
      }
      return new ethers.Contract(marketAddress, MARKET_ABI, readProvider);
    },
    [signer],
  );

  return (
    <WalletContext.Provider
      value={{
        provider,
        signer,
        address,
        isOwner,
        isOwnerLoading,
        isConnected,
        isCorrectNetwork,
        isConnecting,
        error,
        connect,
        disconnect,
        switchNetwork,
        getFactoryContract,
        getLensContract,
        getMarketContract,
        readProvider,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
