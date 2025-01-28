import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ApiService } from "./api-service";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";

export interface MyStackProps extends StackProps {
  vpcTags?: { [key: string]: string };
  clusterName?: string;
}

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: MyStackProps) {
    super(scope, id, props);

    // Create or import VPC based on tags
    const network = Vpc.fromLookup(this, "CustomVpc", {
      tags: props?.vpcTags || {},
    });

    // Create or import ECS cluster
    const cluster = Cluster.fromClusterAttributes(this, "CustomCluster", {
      clusterName: props?.clusterName || "default-cluster",
      vpc: network,
      securityGroups: [],
    });

    // Create API service
    new ApiService(this, "CustomSvc", {
      network,
      cluster,
    });
  }
}
