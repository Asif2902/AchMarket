import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ethers } from 'ethers';
import { NETWORK, FACTORY_ADDRESS } from '../config/network';
import { FACTORY_ABI, MARKET_ABI } from '../config/abis';

interface WalletState {
  provider: ethers.BrowserProvider | null;
  signer: ethers.Signer | null;
  address: string | null;
  isOwner: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  getFactoryContract: (withSigner?: boolean) => ethers.Contract | null;
  getMarketContract: (address: string, withSigner?: boolean) => ethers.Contract | null;
  readProvider: ethers.JsonRpcProvider;
}

const readProvider = new ethers.JsonRpcProvider(NETWORK.rpcUrl, {
  chainId: NETWORK.chainId,
  name: NETWORK.name,
});

const WalletContext = createContext<WalletState>({
  provider: null,
  signer: null,
  address: null,
  isOwner: false,
  isConnected: false,
  isCorrectNetwork: false,
  isConnecting: false,
  error: null,
  connect: async () => {},
  disconnect: () => {},
  switchNetwork: async () => {},
  getFactoryContract: () => null,
  getMarketContract: () => null,
  readProvider,
});

export function useWallet() {
  return useContext(WalletContext);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [isCorrectNetwork, setIsCorrectNetwork] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkOwner = useCallback(async (addr: string) => {
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, readProvider);
      const ownerAddr: string = await factory.owner();
      return ownerAddr.toLowerCase() === addr.toLowerCase();
    } catch {
      return false;
    }
  }, []);

  const checkNetwork = useCallback(async (prov: ethers.BrowserProvider) => {
    try {
      const network = await prov.getNetwork();
      return Number(network.chainId) === NETWORK.chainId;
    } catch {
      return false;
    }
  }, []);

  const setupWallet = useCallback(async (prov: ethers.BrowserProvider) => {
    const correctNetwork = await checkNetwork(prov);
    setIsCorrectNetwork(correctNetwork);

    const s = await prov.getSigner();
    const addr = await s.getAddress();
    setProvider(prov);
    setSigner(s);
    setAddress(addr);

    const owner = await checkOwner(addr);
    setIsOwner(owner);
    setError(null);
  }, [checkNetwork, checkOwner]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      if (!window.ethereum) {
        throw new Error('No wallet detected. Please install MetaMask.');
      }
      const prov = new ethers.BrowserProvider(window.ethereum);
      await prov.send('eth_requestAccounts', []);
      await setupWallet(prov);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to connect wallet';
      setError(msg);
    } finally {
      setIsConnecting(false);
    }
  }, [setupWallet]);

  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setIsOwner(false);
    setIsCorrectNetwork(false);
    setError(null);
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORK.chainIdHex }],
      });
    } catch (switchError: unknown) {
      const err = switchError as { code?: number };
      if (err.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: NETWORK.chainIdHex,
            chainName: NETWORK.name,
            rpcUrls: [NETWORK.rpcUrl],
            nativeCurrency: NETWORK.nativeCurrency,
          }],
        });
      }
    }
    // Re-check after switch
    if (provider) {
      const correct = await checkNetwork(provider);
      setIsCorrectNetwork(correct);
    }
  }, [provider, checkNetwork]);

  const getFactoryContract = useCallback((withSigner = false): ethers.Contract | null => {
    const providerToUse = withSigner && signer ? signer : readProvider;
    return new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, providerToUse);
  }, [signer]);

  const getMarketContract = useCallback((marketAddress: string, withSigner = false): ethers.Contract | null => {
    const providerToUse = withSigner && signer ? signer : readProvider;
    return new ethers.Contract(marketAddress, MARKET_ABI, providerToUse);
  }, [signer]);

  // Listen for account/network changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = async (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        disconnect();
      } else if (provider) {
        await setupWallet(provider);
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum?.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum?.removeListener('chainChanged', handleChainChanged);
    };
  }, [provider, disconnect, setupWallet]);

  // Auto-connect if previously connected
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((result: unknown) => {
        const accounts = result as string[];
        if (accounts.length > 0) {
          connect();
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WalletContext.Provider
      value={{
        provider,
        signer,
        address,
        isOwner,
        isConnected: !!address,
        isCorrectNetwork,
        isConnecting,
        error,
        connect,
        disconnect,
        switchNetwork,
        getFactoryContract,
        getMarketContract,
        readProvider,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// Type augmentation for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
